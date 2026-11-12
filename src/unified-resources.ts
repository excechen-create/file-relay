import { FileSystemAdapter, MarkdownView, Notice, Platform, type Editor, type EditorPosition, type Plugin, type PluginSettingTab } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { DomAdapter } from './dom-adapter';
import { AdapterError } from './errors';
import { mobileWebDav } from './mobile-webdav';
import { ResourceRegistry, type ResourceGroup } from './resource-registry';
import { ResourceRendering } from './resource-rendering';
import { ResourceResolver, type ImageLease } from './resource-resolver';
import { AddResourceGroupModal, ResourceSettingsTab } from './resource-settings-tab';
import { imageMarkdown, imageMime, isResourceUri, normalizeNamespace, parseInlineLink, parseResourceUri } from './resource-uri';
import type { DesktopHttpsTransport } from './desktop-https';
import type { CertificateTrust } from './certificate-trust';
import type { Loader } from './transport';

const storageKey = 'remote-nas-resource-adapter:device-resource-groups:v1';
const local = () => require('./local-resources') as typeof import('./local-resources');
interface ImageInput { source: string; selection?: boolean; notePath?: string }

export class UnifiedResources {
  private registry = new ResourceRegistry();
  private sessions = new Map<string, string>();
  private resolver!: ResourceResolver;
  private transports = new Map<string, DesktopHttpsTransport>();
  private rendering = new ResourceRendering((uri, remoteOnly) => this.acquire(uri, remoteOnly));
  private am = new DomAdapter(document, undefined, undefined, (uri, remoteOnly) => this.acquire(uri, remoteOnly));
  private roots = new Set<Element>();
  private groupPrompt?: AddResourceGroupModal;

  constructor(private plugin: Plugin, legacy?: PluginSettingTab,
    private legacyTrust?: (origin: string) => CertificateTrust | undefined) {
    try { this.registry.replace(plugin.app.loadLocalStorage(storageKey) ?? []); }
    catch { new Notice('外部资源设备配置无效。请检查映射设置。'); }
    this.resetResolver();
    plugin.register(() => {
      this.groupPrompt?.close();
      this.rendering.dispose();
      this.am.dispose();
      this.resolver.dispose();
      for (const transport of this.transports.values()) transport.dispose();
      this.transports.clear();
      this.sessions.clear();
    });
    plugin.addSettingTab(new ResourceSettingsTab(plugin, {
      groups: () => this.registry.list(),
      save: (groups, session) => this.save(groups, session),
      test: (uri, webdav) => webdav ? this.resolver.probeWebdav(uri) : this.acquire(uri),
    }, legacy));
    plugin.registerMarkdownPostProcessor((root, context) => this.rendering.reading(root, context), 100);
    plugin.registerEditorExtension(this.rendering.editorExtension());
    const workspace = plugin.app.workspace;
    plugin.registerEvent(workspace.on('layout-change', () => this.attachViews()));
    plugin.registerEvent(workspace.on('file-open', () => this.attachViews()));
    workspace.onLayoutReady(() => this.attachViews());
    plugin.addCommand({ id: 'retry-external-resources', name: '重新解析外部资源', callback: () => this.reload() });
    if (Platform.isDesktopApp) this.registerConversion();
  }

  acquire(uri: string, remoteOnly = false): ImageLease { return this.resolver.acquire(uri, remoteOnly); }
  stats() { return this.resolver.stats(); }

  private attachViews(): void {
    const roots = new Set<Element>();
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      if (!(leaf.view instanceof MarkdownView)) continue;
      roots.add(leaf.view.containerEl);
      this.am.attach(leaf.view.containerEl);
    }
    for (const root of this.roots) if (!roots.has(root)) this.am.detach(root);
    this.roots = roots;
    this.am.refresh();
  }

  private save(groups: ResourceGroup[], session?: { namespace: string; password: string }): void {
    const next = new ResourceRegistry();
    next.replace(groups);
    const namespace = session ? normalizeNamespace(session.namespace) : undefined;
    if (namespace && !next.get(namespace).username) throw new AdapterError('AUTH', '填写 WebDAV 用户名');
    if (namespace && next.get(namespace).secretId) throw new AdapterError('AUTH', '该资源组已选择钥匙串条目');
    if (session && (!session.password || session.password.length > 4096)) throw new AdapterError('AUTH', '填写有效的本次会话密码');
    const before = new Map(this.registry.list().map(group => [group.namespace, group]));
    const validated = next.list();
    this.plugin.app.saveLocalStorage(storageKey, validated);
    for (const [key] of this.sessions) {
      const current = validated.find(group => group.namespace === key);
      const old = before.get(key);
      if (!current?.enabled || current.webdavRoot !== old?.webdavRoot || current.username !== old?.username ||
        current.secretId !== old?.secretId) this.sessions.delete(key);
    }
    if (namespace && session) this.sessions.set(namespace, session.password);
    this.registry = next;
    this.reload();
  }

  reload(): void {
    this.resetResolver();
    this.rendering.refresh();
    this.am.rebind();
  }

  private resetResolver(): void {
    this.resolver?.dispose();
    for (const transport of this.transports.values()) transport.dispose();
    this.transports.clear();
    this.resolver = new ResourceResolver(this.registry, {
      local: Platform.isDesktopApp ? (root, parts) => local().readableLocalUrl(root, parts, Platform.resourcePathPrefix) : undefined,
      remote: group => this.remote(group),
    });
  }

  private remote(group: Readonly<ResourceGroup>): Loader {
    const credentials = () => {
      if (!group.username) return null;
      const password = group.secretId ? this.plugin.app.secretStorage?.getSecret(group.secretId) : this.sessions.get(group.namespace);
      if (password == null || password.length > 4096) throw new AdapterError('AUTH', '需要有效的 WebDAV 密码');
      return { username: group.username, password };
    };
    if (!Platform.isDesktopApp) return mobileWebDav(credentials);
    const desktop = require('./desktop-https') as typeof import('./desktop-https');
    const options = {
      origin: new URL(group.webdavRoot).origin, getCredentials: credentials, allowAnonymous: !group.username,
    };
    const existing = this.transports.get(group.namespace);
    if (existing) return existing.load;
    const trust = group.useLegacyCertificate ? this.legacyTrust?.(options.origin) : undefined;
    if (group.useLegacyCertificate && !trust) throw new AdapterError('TLS', '该主机和端口没有已核准的旧映射证书');
    const transport = trust ? desktop.createCertificateHttpsTransport(options, trust) : desktop.createDesktopHttpsTransport(options);
    this.transports.set(group.namespace, transport);
    return transport.load;
  }

  private convert({ source, selection, notePath }: ImageInput, groups = this.registry.list()): string | null {
    const candidate = source.trim();
    if (!candidate || /[\r\n]/.test(candidate)) return null;
    const link = selection ? parseInlineLink(candidate) : null;
    const target = link?.target ?? candidate;
    const adapter = this.plugin.app.vault.adapter;
    const note = notePath && adapter instanceof FileSystemAdapter ? { vaultRoot: adapter.getBasePath(), file: notePath } : undefined;
    try {
      const ref = selection && isResourceUri(target) ? parseResourceUri(target) : local().localReference(target, groups, note);
      if (!ref) return null;
      if (!groups.some(group => group.enabled && group.namespace === ref.namespace)) return null;
      imageMime(ref.parts.at(-1)!);
      return imageMarkdown(ref, link?.alt, link?.title);
    }
    catch { return null; }
  }

  private registerConversion(): void {
    const workspace = this.plugin.app.workspace;
    this.plugin.addCommand({ id: 'convert-selected-resource-path', name: '将选中的外部路径转换为资源图片', editorCallback: (editor, info) => {
      if (!this.insertImages([{ source: editor.getSelection(), selection: true, notePath: info.file?.path }], editor))
        new Notice('选中的图片路径未匹配已启用的资源组。');
    } });
    this.plugin.registerEvent(workspace.on('editor-paste', (event, editor) => {
      const data = event.clipboardData;
      if (event.defaultPrevented || !data) return;
      let sources: string[] = [];
      if (data.files.length) sources = this.filePaths(data.files);
      else if (!data.types.includes('text/html')) {
        const uris = data.getData('text/uri-list').split(/\r?\n/).map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
        if (uris.length && uris.every(uri => /^file:\/\//i.test(uri))) sources = uris;
        else if (!uris.length) sources = [data.getData('text/plain')];
      }
      if (this.insertImages(sources.map(source => ({ source })), editor)) event.preventDefault();
    }));
    this.plugin.registerEvent(workspace.on('editor-drop', (event, editor) => {
      if (event.defaultPrevented || !event.dataTransfer?.files.length) return;
      const target = (event.target as Element | null)?.closest?.<HTMLElement>('.cm-editor');
      const offset = target && EditorView.findFromDOM(target)?.posAtCoords({ x: event.clientX, y: event.clientY });
      if (offset == null) return;
      const sources = this.filePaths(event.dataTransfer.files);
      if (this.insertImages(sources.map(source => ({ source })), editor, editor.offsetToPos(offset))) event.preventDefault();
    }));
  }

  private filePaths(files: FileList): string[] {
    try {
      const { webUtils } = require('electron');
      return webUtils ? Array.from(files, file => webUtils.getPathForFile(file)) : [];
    } catch { return []; }
  }

  private insertImages(inputs: ImageInput[], editor: Editor, at?: EditorPosition): boolean {
    if (!inputs.length) return false;
    const links = inputs.map(input => this.convert(input));
    if (links.every(Boolean)) {
      if (at) editor.replaceRange(links.join('\n'), at);
      else editor.replaceSelection(links.join('\n'));
      return true;
    }
    const adapter = this.plugin.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return false;
    const vaultRoot = adapter.getBasePath();
    const files = inputs.map(({ source, selection, notePath }) => {
      const candidate = source.trim();
      const target = selection ? parseInlineLink(candidate)?.target ?? candidate : candidate;
      const file = local().absoluteLocalPath(target, notePath ? { vaultRoot, file: notePath } : undefined);
      if (!file) return null;
      try { imageMime(file); return file; }
      catch { return null; }
    });
    if (files.some(file => file === null)) return false;
    const root = local().suggestLocalRoot(files.filter((file, index): file is string => file !== null && !links[index]), vaultRoot);
    if (root === null) return false;
    const from = at ?? editor.getCursor('from');
    const to = at ?? editor.getCursor('to');
    const original = editor.getValue();
    const workspace = this.plugin.app.workspace;
    const originalFile = workspace.getActiveFile()?.path;
    this.groupPrompt?.close();
    this.groupPrompt = new AddResourceGroupModal(this.plugin.app, root, (name, localRoot) => {
      if (workspace.getActiveFile()?.path !== originalFile || editor.getValue() !== original)
        throw new AdapterError('PATH', '笔记已切换或修改，请重新粘贴或拖入图片。');
      const namespace = normalizeNamespace(name);
      const groups = this.registry.list();
      if (!localRoot) throw new AdapterError('PATH', '请输入图片所在的本地绝对目录。');
      if (groups.some(group => group.namespace === namespace)) throw new AdapterError('PATH', '该资源组名已存在。');
      groups.push({ namespace, localRoot, enabled: true, backendStrategy: 'auto', webdavRoot: '', username: '', secretId: '' });
      const converted = inputs.map(input => this.convert(input, groups));
      if (converted.some(link => !link)) throw new AdapterError('PATH', '本地目录须包含所有尚未匹配的图片。');
      this.save(groups);
      editor.replaceRange(converted.join('\n'), from, to);
    });
    this.groupPrompt.open();
    return true;
  }
}
