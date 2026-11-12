import { App, Modal, Notice, Platform, PluginSettingTab, SecretComponent, Setting, type Plugin } from 'obsidian';
import { AdapterError, errorCode } from './errors';
import type { ResourceGroup, BackendStrategy } from './resource-registry';
import type { ImageLease } from './resource-resolver';

export class AddResourceGroupModal extends Modal {
  constructor(app: App, private root: string, private add: (name: string, root: string) => void) { super(app); }

  onOpen(): void {
    this.setTitle('为外部图片新增资源组？');
    this.contentEl.createEl('p', { text: '图片所在目录还没有匹配的资源组。保存后会插入资源链接，图片留在原目录。' });
    let name = '';
    let root = this.root;
    let nameInput: HTMLInputElement | undefined;
    new Setting(this.contentEl).setName('资源组名')
      .addText(text => { nameInput = text.inputEl; text.setPlaceholder('research').onChange(value => { name = value.trim(); }); });
    new Setting(this.contentEl).setName('本地图片目录')
      .addText(text => text.setValue(root).onChange(value => { root = value.trim(); }));
    const error = this.contentEl.createEl('p', { attr: { role: 'status' } });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText('取消').onClick(() => this.close()))
      .addButton(button => button.setButtonText('新增并插入').setCta().onClick(() => {
        try { this.add(name, root); this.close(); }
        catch (cause) { error.setText(cause instanceof AdapterError ? cause.message : '无法保存资源组。'); }
      }));
    nameInput?.focus();
  }

  onClose(): void { this.contentEl.empty(); }
}

interface SettingsApi {
  groups(): ResourceGroup[];
  save(groups: ResourceGroup[], session?: { namespace: string; password: string }): void;
  test(uri: string, webdav: boolean): ImageLease;
  migrate(restore: boolean): void;
}

export class ResourceSettingsTab extends PluginSettingTab {
  private draft: ResourceGroup[] = [];
  private passwords = new Map<ResourceGroup, string>();
  private status?: HTMLElement;
  private probe?: ImageLease;
  private sample = '';

  constructor(plugin: Plugin, private api: SettingsApi, private legacy?: PluginSettingTab) { super(plugin.app, plugin); }
  display(): void { this.draft = this.api.groups(); this.render(); }
  hide(): void {
    this.legacy?.hide();
    this.probe?.release(); this.probe = undefined; this.passwords.clear();
    for (const input of this.containerEl.querySelectorAll('input[type=password]')) (input as HTMLInputElement).value = '';
  }

  private render(): void {
    const el = this.containerEl;
    el.empty();
    this.passwords.clear();
    new Setting(el).setName('外部资源映射').setHeading();
    if (!this.draft.length) el.createEl('p', { text: Platform.isDesktopApp
      ? '添加资源组后，可将目录中的图片粘贴为 nas:// 链接。'
      : '添加与其他设备同名的资源组，然后设置 WebDAV。' });
    for (const group of this.draft) {
      const section = el.createEl('details', { cls: 'nas-resource-group' });
      section.open = this.draft.length === 1 || !group.namespace;
      const summary = section.createEl('summary', { text: group.namespace || '新资源组' });
      new Setting(section).setName('资源组名')
        .setDesc('例如 research，对应 nas://research/；其他设备用同名资源组。')
        .addText(text => text.setPlaceholder('research').setValue(group.namespace).onChange(value => {
          group.namespace = value.trim(); summary.setText(group.namespace || '新资源组');
        }));
      if (Platform.isDesktopApp) new Setting(section).setName('本地图片目录')
        .setDesc('例如 D:\\Research，目录下的 Raman\\001.png 对应 nas://research/Raman/001.png。')
        .addText(text => text.setValue(group.localRoot).onChange(value => { group.localRoot = value.trim(); }));
      const webdav = section.createEl('details');
      webdav.open = !Platform.isDesktopApp;
      webdav.createEl('summary', { text: 'WebDAV' });
      new Setting(webdav).setName('HTTPS 根地址')
        .addText(text => text.setValue(group.webdavRoot).onChange(value => { group.webdavRoot = value.trim(); }));
      new Setting(webdav).setName('用户名')
        .addText(text => text.setValue(group.username).onChange(value => { group.username = value; }));
      const secret = new Setting(webdav).setName('钥匙串密码');
      if (typeof SecretComponent === 'function' && typeof this.app.secretStorage?.getSecret === 'function') {
        secret.setDesc('选择或创建保存了 WebDAV 密码的 Obsidian 钥匙串条目，再点「保存映射」。');
        const select = new SecretComponent(this.app, secret.controlEl);
        select.setValue(group.secretId).onChange(value => { group.secretId = value ?? ''; });
      } else {
        secret.setDesc('当前版本未提供钥匙串，可在「更多选项」中填写会话密码。');
      }
      const advanced = section.createEl('details');
      advanced.createEl('summary', { text: '更多选项' });
      new Setting(advanced).setName('会话密码').setDesc('资源组未选择钥匙串条目时可用。').addText(text => {
        text.inputEl.type = 'password'; text.inputEl.autocomplete = 'off';
        text.onChange(value => { if (value) this.passwords.set(group, value); else this.passwords.delete(group); });
      }).addButton(button => button.setButtonText('保存并使用').onClick(() => {
        this.save({ namespace: group.namespace, password: this.passwords.get(group) ?? '' });
      }));
      new Setting(advanced).setName('启用资源组')
        .addToggle(toggle => toggle.setValue(group.enabled).onChange(value => { group.enabled = value; }))
        .addButton(button => button.setButtonText('删除组').onClick(() => {
          this.draft = this.draft.filter(item => item !== group);
          this.render();
        }));
      if (Platform.isDesktopApp) new Setting(advanced).setName('使用旧映射已核准的证书')
        .setDesc('仅适用于旧设置中完全相同的 HTTPS 主机和端口。')
        .addToggle(toggle => toggle.setValue(group.useLegacyCertificate === true).onChange(value => { group.useLegacyCertificate = value; }));
      new Setting(advanced).setName('读取策略').addDropdown(dropdown => dropdown
        .addOptions({ auto: '自动', 'local-only': '仅本地', 'webdav-only': '仅 WebDAV' })
        .setValue(group.backendStrategy).onChange(value => { group.backendStrategy = value as BackendStrategy; }));
    }
    new Setting(el)
      .addButton(button => button.setButtonText('添加资源组').onClick(() => {
        this.draft.push({ namespace: '', enabled: true, localRoot: '', webdavRoot: '', backendStrategy: 'auto', username: '', secretId: '' });
        this.render();
      }))
      .addButton(button => button.setButtonText('保存映射').setCta().onClick(() => this.save()));
    if (Platform.isDesktopApp) {
      const migration = el.createEl('details', { cls: 'nas-resource-settings-details' });
      migration.createEl('summary', { text: '笔记链接转换' });
      new Setting(migration).setName('本 Vault 的图片链接').setDesc('只转换匹配已启用资源组的本地图片链接。')
        .addButton(button => button.setButtonText('转换本地图片链接').onClick(() => this.api.migrate(false)))
        .addButton(button => button.setButtonText('恢复上次转换').onClick(() => this.api.migrate(true)));
    }
    const diagnostics = el.createEl('details', { cls: 'nas-resource-settings-details' });
    diagnostics.createEl('summary', { text: '连接测试' });
    new Setting(diagnostics).setName('图片链接').setDesc('粘贴已保存资源组里的 nas:// 图片链接。')
      .addText(text => text.setPlaceholder('nas://research/example.png').setValue(this.sample).onChange(value => { this.sample = value.trim(); }))
      .addButton(button => button.setButtonText('测试当前策略').onClick(() => void this.test(false)))
      .addButton(button => button.setButtonText('测试 WebDAV').onClick(() => void this.test(true)));
    this.status = diagnostics.createEl('p', { attr: { role: 'status' } });
    if (this.legacy) {
      const legacy = this.legacy;
      const details = el.createEl('details', { cls: 'nas-resource-settings-details' });
      details.createEl('summary', { text: '旧 Windows 路径映射设置' });
      legacy.containerEl = details.createDiv();
      details.addEventListener('toggle', () => { if (details.open) legacy.display(); else legacy.hide(); });
    }
  }

  private save(session?: { namespace: string; password: string }): void {
    try {
      this.api.save(this.draft, session);
      this.hide(); this.display();
      new Notice('已保存资源映射。');
    } catch (error) { new Notice(this.message(error)); }
  }

  private async test(remoteOnly: boolean): Promise<void> {
    this.probe?.release();
    const lease = this.api.test(this.sample, remoteOnly);
    this.probe = lease;
    this.status?.setText('正在解析…');
    try {
      const result = await lease.result;
      if (this.probe === lease) this.status?.setText(result.backend === 'local' ? '本地目标文件可读。' : 'WebDAV 图片读取成功。');
    } catch (error) {
      if (this.probe === lease) this.status?.setText(this.message(error));
    } finally { lease.release(); if (this.probe === lease) this.probe = undefined; }
  }

  private message(error: unknown): string { return error instanceof AdapterError ? error.code + ' · ' + error.message : errorCode(error); }
}
