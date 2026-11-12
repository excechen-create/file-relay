import { Modal, Notice, Setting, type App } from 'obsidian';
import { isResourceUri, parseInlineLink } from './resource-uri';

interface Change { path: string; before: string; after: string }
const backupKey = 'file-relay:last-link-migration:v1';

export class LinkMigration {
  private busy = false;

  constructor(private app: App, private convert: (source: string, notePath: string) => string | null) {}

  async start(restore: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const backup = this.app.loadLocalStorage(backupKey) as Change[] | null;
      let links = 0;
      const changes: Change[] = [];
      if (restore) changes.push(...(backup ?? []));
      else for (const file of this.app.vault.getMarkdownFiles()) {
        const before = await this.app.vault.read(file);
        let fence = '';
        const after = before.split(/(?<=\n)/).map(line => {
          const marker = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)/.exec(line);
          if (marker) {
            const delimiter = marker[1]!;
            if (!fence) fence = delimiter;
            else if (fence[0] === delimiter[0] && delimiter.length >= fence.length && !marker[2]?.trim()) fence = '';
            return line;
          }
          if (fence || /^(?: {4}|\t)/.test(line)) return line;
          return line.replace(/(`+)[^`\r\n]*\1|(?<!\\)!\[(?:\\.|[^\]\\\r\n])*\]\((?:<[^>\r\n]+>|[^()\r\n]+)\)/g, (original, code) => {
            if (code) return original;
            const source = parseInlineLink(original);
            if (!source || isResourceUri(source.target)) return original;
            const converted = this.convert(original, file.path);
            if (!converted) return original;
            const destination = parseInlineLink(converted)?.target;
            const index = original.indexOf('](');
            const targetStart = index + 2 + (original[index + 2] === '<' ? 1 : 0);
            if (!destination || index < 0 || original.slice(targetStart, targetStart + source.target.length) !== source.target) return original;
            links++;
            return original.slice(0, targetStart) + destination + original.slice(targetStart + source.target.length);
          });
        }).join('');
        if (before !== after) changes.push({ path: file.path, before, after });
      }
      if (!changes.length) {
        new Notice(restore ? '没有可恢复的转换。' : '未找到能匹配已启用资源组的本地图片链接。');
        return;
      }
      if (!await this.confirm(restore, changes.length, links, !!backup)) return;
      for (const change of changes) {
        const file = this.app.vault.getFileByPath(change.path);
        if (!file) throw Error('找不到笔记：' + change.path);
        const current = await this.app.vault.read(file);
        if (current !== change.before && (!restore || current !== change.after))
          throw Error('笔记已有其他修改，操作已停止：' + change.path);
      }
      if (!restore) {
        this.app.saveLocalStorage(backupKey, changes);
        if (JSON.stringify(this.app.loadLocalStorage(backupKey)) !== JSON.stringify(changes))
          throw Error('无法确认恢复备份已保存，转换已停止。');
      }
      for (const change of changes) {
        const file = this.app.vault.getFileByPath(change.path);
        if (!file) throw Error('找不到笔记：' + change.path);
        await this.app.vault.process(file, current => {
          const desired = restore ? change.before : change.after;
          if (current === desired) return current;
          if (current !== (restore ? change.after : change.before)) throw Error('笔记在操作期间发生变化：' + change.path);
          return desired;
        });
      }
      if (restore) this.app.saveLocalStorage(backupKey, null);
      new Notice(restore ? '已恢复上次转换。' : '已转换 ' + links + ' 条图片链接。');
    } catch (error) {
      new Notice(error instanceof Error ? error.message : '链接操作失败。', 10000);
    } finally { this.busy = false; }
  }

  private confirm(restore: boolean, notes: number, links: number, previous: boolean): Promise<boolean> {
    return new Promise(resolve => {
      const modal = new Modal(this.app);
      modal.setTitle(restore ? '恢复上次图片链接转换？' : '转换本 Vault 的图片链接？');
      modal.contentEl.createEl('p', { text: restore
        ? '检查并恢复 ' + notes + ' 篇笔记。发现后续内容修改时会停止。'
        : '将 ' + notes + ' 篇笔记中的 ' + links + ' 条图片链接转换为 nas://。原文保存在本设备。' +
          (previous ? '本次转换将替换上一份恢复记录。' : '') });
      modal.onClose = () => { modal.contentEl.empty(); resolve(false); };
      new Setting(modal.contentEl)
        .addButton(button => button.setButtonText('取消').onClick(() => modal.close()))
        .addButton(button => button.setButtonText(restore ? '确认恢复' : '确认转换').setCta().onClick(() => {
          resolve(true); modal.close();
        }));
      modal.open();
    });
  }
}
