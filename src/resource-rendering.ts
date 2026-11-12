import { editorLivePreviewField, MarkdownRenderChild, type MarkdownPostProcessorContext } from 'obsidian';
import type { Extension } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { AdapterError, errorCode } from './errors';
import { isResourceUri } from './resource-uri';
import type { ImageLease } from './resource-resolver';

type Acquire = (uri: string, remoteOnly?: boolean) => ImageLease;

export class ResourceRendering {
  private bindings = new Map<() => void, () => void>();
  constructor(private acquire: Acquire) {}

  refresh(): void { for (const refresh of this.bindings.values()) refresh(); }
  dispose(): void { for (const cleanup of this.bindings.keys()) cleanup(); }

  reading(root: HTMLElement, context: MarkdownPostProcessorContext): void {
    const images = [...root.querySelectorAll('img')].flatMap(image => {
      const source = image.getAttribute('src') ?? image.getAttribute('data-src') ?? '';
      return isResourceUri(source) && !image.closest('.vml-layout') ? [{ image, source }] : [];
    });
    if (!images.length) return;
    const child = new MarkdownRenderChild(root);
    const cleanups = images.map(({ image, source }) => this.bind(image, source));
    child.register(() => cleanups.forEach(cleanup => cleanup()));
    context.addChild(child);
  }

  private bind(image: HTMLImageElement, uri: string): () => void {
    const src = image.getAttribute('src');
    const title = image.getAttribute('title');
    let lease: ImageLease | undefined;
    let backend: 'local' | 'webdav' | undefined;
    let assigned: string | undefined;
    let fallback = false;
    const showError = (error: unknown) => {
      image.dataset.resourceState = 'error';
      image.dataset.resourceError = errorCode(error);
      image.title = error instanceof AdapterError ? error.message : errorCode(error);
    };
    const load = (remoteOnly = false) => {
      lease?.release();
      const current = this.acquire(uri, remoteOnly);
      lease = current;
      image.dataset.resourceState = 'loading';
      delete image.dataset.resourceError;
      if (title === null) image.removeAttribute('title'); else image.title = title;
      void current.result.then(resolved => {
        const currentSrc = image.getAttribute('src');
        if (lease !== current || (currentSrc !== null && currentSrc !== src && currentSrc !== assigned)) {
          current.release();
          return;
        }
        backend = resolved.backend;
        assigned = resolved.url;
        image.dataset.resourceUrl = assigned;
        image.setAttribute('src', assigned);
        image.dataset.resourceState = 'ready';
      }, error => {
        if (lease !== current) return;
        current.release();
        showError(error);
      });
    };
    const onError = () => {
      if (!assigned || image.getAttribute('src') !== assigned) return;
      if (backend === 'local' && !fallback) { fallback = true; load(true); }
      else showError(new AdapterError('IMAGE', '图片解码失败'));
    };
    const refresh = () => {
      fallback = false; assigned = undefined; backend = undefined;
      delete image.dataset.resourceUrl;
      image.removeAttribute('src');
      load();
    };
    const cleanup = () => {
      if (!this.bindings.delete(cleanup)) return;
      image.removeEventListener('error', onError);
      lease?.release();
      lease = undefined;
      delete image.dataset.resourceState;
      delete image.dataset.resourceError;
      delete image.dataset.resourceUrl;
      const current = image.getAttribute('src');
      if (current === null || current === assigned) {
        if (src === null) image.removeAttribute('src'); else image.setAttribute('src', src);
      }
      if (title === null) image.removeAttribute('title'); else image.title = title;
    };
    this.bindings.set(cleanup, refresh);
    image.addEventListener('error', onError);
    refresh();
    return cleanup;
  }

  editorExtension(): Extension {
    const bind = (image: HTMLImageElement, uri: string) => this.bind(image, uri);
    // Obsidian's own Live Preview widget retains the logical src and owns cursor editing.
    // The extension follows only that editor's widgets, including asynchronous inserts.
    return ViewPlugin.fromClass(class {
      private observer: MutationObserver;
      private images = new Map<HTMLImageElement, { source: string; cleanup: () => void }>();

      constructor(private view: EditorView) {
        this.observer = new view.dom.ownerDocument.defaultView!.MutationObserver(records => {
          for (const record of records) {
            if (record.type === 'attributes') this.scan(record.target as Element);
            else for (const node of record.addedNodes) if (node.nodeType === 1) this.scan(node as Element);
          }
          this.sweep();
        });
        this.observer.observe(view.contentDOM, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
        this.scan(view.contentDOM);
      }

      update(update: ViewUpdate): void {
        if (this.enabled(update.startState) === this.enabled(update.state)) return;
        this.sweep();
        this.scan(this.view.contentDOM);
      }

      private enabled(state = this.view.state): boolean { return state.field(editorLivePreviewField, false) === true; }

      private scan(root: Element): void {
        if (!this.enabled()) return;
        const images = root.tagName === 'IMG' ? [root as HTMLImageElement] : root.querySelectorAll<HTMLImageElement>('img');
        for (const image of images) {
          if (!this.view.contentDOM.contains(image) || image.closest('.vml-layout')) continue;
          const source = image.getAttribute('src') ?? '';
          if (!isResourceUri(source)) continue;
          if (this.images.get(image)?.source === source) {
            const resolved = image.dataset.resourceUrl;
            if (resolved && image.dataset.resourceState === 'ready') image.setAttribute('src', resolved);
            continue;
          }
          this.images.get(image)?.cleanup();
          this.images.set(image, { source, cleanup: bind(image, source) });
        }
      }

      private sweep(): void {
        for (const [image, binding] of this.images) {
          const src = image.getAttribute('src') ?? '';
          if (this.enabled() && this.view.contentDOM.contains(image) && !image.closest('.vml-layout') &&
            (!src || src === binding.source || image.dataset.resourceUrl === src)) continue;
          this.images.delete(image);
          binding.cleanup();
        }
      }

      destroy(): void {
        this.observer.disconnect();
        for (const binding of this.images.values()) binding.cleanup();
        this.images.clear();
      }
    });
  }
}
