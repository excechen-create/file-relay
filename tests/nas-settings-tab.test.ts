import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nasDefaults, serializeNasSettings, type NasSettings } from '../src/nas-settings';
import type { NasPluginApi } from '../src/nas-settings-tab';
import type { DiscoveryResult } from '../src/webdav';
import type { App, Plugin } from 'obsidian';

vi.mock('obsidian', () => {
  Object.assign(HTMLElement.prototype, {
    setText(this: HTMLElement, value: string) { this.textContent = value; return this; },
  });
  class PluginSettingTab {
    app: unknown;
    plugin: unknown;
    containerEl: HTMLElement;
    constructor(app: unknown, plugin: unknown) {
      this.app = app;
      this.plugin = plugin;
      this.containerEl = document.createElement('div');
      Object.assign(this.containerEl, {
        empty(this: HTMLElement) { this.replaceChildren(); return this; },
        createEl(this: HTMLElement, tag: string, options: { cls?: string; text?: string } = {}) {
          const element = document.createElement(tag);
          if (options.cls) element.className = options.cls;
          if (options.text) element.textContent = options.text;
          this.append(element);
          return element;
        },
      });
    }
    hide(): void {}
  }
  class Setting {
    settingEl: HTMLDivElement;
    constructor(container: HTMLElement) {
      this.settingEl = document.createElement('div');
      this.settingEl.className = 'setting-item';
      container.append(this.settingEl);
    }
    setName(name: string): this {
      this.settingEl.dataset.name = name;
      const label = document.createElement('span');
      label.textContent = name;
      this.settingEl.append(label);
      return this;
    }
    setDesc(description: string): this {
      const desc = document.createElement('span');
      desc.textContent = description;
      this.settingEl.append(desc);
      return this;
    }
    addText(callback: (component: any) => void): this {
      const inputEl = document.createElement('input');
      this.settingEl.append(inputEl);
      callback({
        inputEl,
        setValue(value: string) { inputEl.value = value; return this; },
        setPlaceholder(value: string) { inputEl.placeholder = value; return this; },
        onChange(handler: (value: string) => void) {
          inputEl.addEventListener('input', () => handler(inputEl.value));
          return this;
        },
      });
      return this;
    }
    addTextArea(callback: (component: any) => void): this {
      const inputEl = document.createElement('textarea');
      this.settingEl.append(inputEl);
      callback({
        inputEl,
        setValue(value: string) { inputEl.value = value; return this; },
        onChange(handler: (value: string) => void) {
          inputEl.addEventListener('input', () => handler(inputEl.value));
          return this;
        },
      });
      return this;
    }
    addButton(callback: (component: any) => void): this {
      const buttonEl = document.createElement('button');
      this.settingEl.append(buttonEl);
      const component = {
        buttonEl,
        setButtonText(value: string) { buttonEl.textContent = value; return this; },
        setCta() { return this; },
        setDisabled(value: boolean) { buttonEl.disabled = value; return this; },
        onClick(handler: () => void) { buttonEl.addEventListener('click', handler); return this; },
      };
      callback(component);
      return this;
    }
    addDropdown(callback: (component: any) => void): this {
      const selectEl = document.createElement('select');
      this.settingEl.append(selectEl);
      callback({
        selectEl,
        addOption(value: string, label: string) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          selectEl.append(option);
          return this;
        },
        setValue(value: string) { selectEl.value = value; return this; },
        onChange(handler: (value: string) => void) {
          selectEl.addEventListener('change', () => handler(selectEl.value));
          return this;
        },
      });
      return this;
    }
    addComponent(callback: (element: HTMLElement) => void): this {
      const element = document.createElement('div');
      this.settingEl.append(element);
      callback(element);
      return this;
    }
  }
  class Modal {
    app: unknown;
    modalEl = document.createElement('div');
    containerEl = document.createElement('div');
    contentEl = document.createElement('div');
    titleEl = document.createElement('h2');
    constructor(app: unknown) { this.app = app; }
    open(): void {}
    close(): void {}
  }
  class Notice { constructor(_message: string) {} }
  class SecretComponent {
    constructor(_app: unknown, _element: HTMLElement) {}
    setValue(_value: string): this { return this; }
    onChange(_handler: (value: string | null) => void): this { return this; }
  }
  return { PluginSettingTab, Setting, Modal, Notice, SecretComponent };
});

import { NasSettingsTab } from '../src/nas-settings-tab';
import { Modal } from 'obsidian';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const result = (webdavRoot = '/Data'): DiscoveryResult => ({
  candidates: [{ windowsRoot: 'D:/Sync', webdavRoot, evidence: ['Sample/photo.png'] }],
  requests: 2,
  complete: true,
  issues: [],
});

function setup(overrides: Partial<NasSettings> = {}) {
  const settings: NasSettings = {
    ...nasDefaults(),
    endpoint: 'https://nas.example:5006',
    mappings: [
      { windowsRoot: 'D:/Sync', webdavRoot: '' },
      { windowsRoot: 'E:/Images', webdavRoot: '' },
    ],
    samplePaths: ['D:/Sync/Sample/photo.png'],
    ...overrides,
  };
  const apiState = structuredClone(settings);
  const discovery = deferred<DiscoveryResult>();
  const api: NasPluginApi & Plugin = {
    getNasSettings: vi.fn(() => structuredClone(serializeNasSettings(apiState))),
    updateNasSettings: vi.fn(async (value: NasSettings) => {
      Object.assign(apiState, structuredClone(serializeNasSettings(value)));
    }),
    probeNas: vi.fn(async () => ({ tlsVerified: true, message: 'ok' })),
    nasTlsVerified: vi.fn(() => true),
    setNasSessionPassword: vi.fn(),
    listNasRoot: vi.fn(async () => []),
    discoverNasMapping: vi.fn(() => discovery.promise),
    enableNasImages: vi.fn(async () => {}),
    disableNasImages: vi.fn(async () => {}),
    addCommand: vi.fn(),
    addSettingTab: vi.fn(),
    register: vi.fn(),
    registerEvent: vi.fn(),
    registerDomEvent: vi.fn(),
    registerInterval: vi.fn(),
    loadData: vi.fn(async () => null),
    saveData: vi.fn(async () => {}),
  } as unknown as NasPluginApi & Plugin;
  const tab = new NasSettingsTab({} as App, api);
  tab.display();
  const button = (label: string, index = 0): HTMLButtonElement => {
    const matches = [...tab.containerEl.querySelectorAll('button')]
      .filter((candidate) => candidate.textContent === label);
    if (!matches[index]) throw new Error(`Button not found: ${label} #${index}`);
    return matches[index]!;
  };
  const textInput = (name: string, index = 0): HTMLInputElement => {
    const rows = [...tab.containerEl.querySelectorAll<HTMLElement>('.setting-item')]
      .filter((row) => row.dataset.name === name);
    const input = rows[index]?.querySelector('input');
    if (!input) throw new Error(`Input not found: ${name} #${index}`);
    return input;
  };
  const area = (name: string): HTMLTextAreaElement => {
    const row = [...tab.containerEl.querySelectorAll<HTMLElement>('.setting-item')]
      .find((item) => item.dataset.name === name);
    const input = row?.querySelector('textarea');
    if (!input) throw new Error(`Textarea not found: ${name}`);
    return input;
  };
  return { tab, api, apiState, discovery, button, textInput, area };
}

function edit(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('NasSettingsTab async operation guards', () => {
  beforeEach(() => { document.body.replaceChildren(); });
  afterEach(() => { document.body.replaceChildren(); });

  describe.each(['stop','hide'] as const)('%s while saving', cancel => {
    it.each([
      ['启用 NAS 图片','enableNasImages'],
      ['保存并验证 HTTPS','probeNas'],
      ['读取根目录','listNasRoot'],
    ] as const)('does not continue %s after cancellation', async (label,method) => {
      const s = setup({credentialSource:'secret',passwordSecretId:'test-only',
        mappings:[{windowsRoot:'D:/Sync',webdavRoot:'/Data'}]});
      const save = deferred<void>();
      vi.mocked(s.api.updateNasSettings).mockReturnValueOnce(save.promise);
      s.button(label).click();
      await flush();
      expect(s.api.updateNasSettings).toHaveBeenCalledTimes(1);
      if(cancel==='stop'){
        s.button('停止 NAS 并清空会话凭据').click();
        await flush();
        expect(s.api.disableNasImages).toHaveBeenCalledWith(true);
      }else s.tab.hide();
      save.resolve();
      await flush();
      expect(s.api[method]).not.toHaveBeenCalled();
      if(cancel==='stop')expect(s.tab.containerEl.textContent).toContain('NAS 模式已停止');
    });

    it('does not open the session password modal after cancellation', async () => {
      const s = setup(), save = deferred<void>(), opened = vi.spyOn(Modal.prototype,'open');
      vi.mocked(s.api.updateNasSettings).mockReturnValueOnce(save.promise);
      s.button('输入本次凭据').click();
      await flush();
      if(cancel==='stop')s.button('停止 NAS 并清空会话凭据').click();
      else s.tab.hide();
      await flush();
      save.resolve();
      await flush();
      expect(opened).not.toHaveBeenCalled();
    });
  });

  describe.each(['success','failure'] as const)('late %s after stopping', outcome => {
    it.each([
      ['启用 NAS 图片','enableNasImages',undefined],
      ['保存并验证 HTTPS','probeNas',{tlsVerified:true,message:'Late HTTPS success'}],
      ['读取根目录','listNasRoot',[]],
    ] as const)('does not let %s overwrite the stopped status', async (label,method,value) => {
      const s = setup({credentialSource:'secret',passwordSecretId:'test-only',
        mappings:[{windowsRoot:'D:/Sync',webdavRoot:'/Data'}]});
      const pending = deferred<never>();
      vi.mocked(s.api[method]).mockReturnValueOnce(pending.promise);
      s.button(label).click();
      await flush();
      expect(s.api[method]).toHaveBeenCalledTimes(1);
      s.button('停止 NAS 并清空会话凭据').click();
      await flush();
      const stoppedStatus = s.tab.containerEl.textContent;
      expect(stoppedStatus).toContain('NAS 模式已停止');
      if(outcome==='success')pending.resolve(value as never);
      else pending.reject(new Error('Late operation failure'));
      await flush();
      expect(s.tab.containerEl.textContent).toBe(stoppedStatus);
    });
  });

  it('allows a new explicit enable after the stopped save finishes', async () => {
    const s = setup({credentialSource:'secret',passwordSecretId:'test-only',
      mappings:[{windowsRoot:'D:/Sync',webdavRoot:'/Data'}]});
    const save = deferred<void>();
    vi.mocked(s.api.updateNasSettings).mockReturnValueOnce(save.promise);
    s.button('启用 NAS 图片').click();
    await flush();
    s.button('停止 NAS 并清空会话凭据').click();
    await flush();
    save.resolve();
    await flush();
    expect(s.api.enableNasImages).not.toHaveBeenCalled();
    s.button('启用 NAS 图片').click();
    await flush();
    expect(s.api.enableNasImages).toHaveBeenCalledTimes(1);
    expect(s.tab.containerEl.textContent).toContain('NAS 图片模式已启用');
  });

  it('does not let a mapping save finishing after stop replace the stopped status', async () => {
    const s = setup(), save = deferred<void>();
    vi.mocked(s.api.updateNasSettings).mockResolvedValueOnce(undefined).mockReturnValueOnce(save.promise);
    s.button('核对候选').click();
    await flush();
    s.discovery.resolve(result('/Verified'));
    await flush();
    expect(s.api.updateNasSettings).toHaveBeenCalledTimes(2);
    s.button('停止 NAS 并清空会话凭据').click();
    await flush();
    save.resolve();
    await flush();
    expect(s.tab.containerEl.textContent).toContain('NAS 模式已停止');
    expect(s.tab.containerEl.textContent).not.toContain('找到唯一候选');
  });

  it('saves and applies the sole complete candidate to the selected mapping', async () => {
    const s = setup();
    s.button('核对候选').click();
    await flush();
    expect(s.api.discoverNasMapping).toHaveBeenCalledWith(0);
    s.discovery.resolve(result('/Verified/Sample'));
    await flush();
    expect(s.api.updateNasSettings).toHaveBeenCalledTimes(2);
    expect(s.apiState.mappings[0]?.webdavRoot).toBe('/Verified/Sample');
    expect(s.apiState.mappings[1]?.webdavRoot).toBe('');
  });

  it('does not apply a result to a mapping that shifted after deletion', async () => {
    const s = setup();
    s.button('核对候选').click();
    await flush();
    s.button('移除此映射').click();
    s.discovery.resolve(result('/Wrong/First'));
    await flush();
    expect(s.api.updateNasSettings).toHaveBeenCalledTimes(1);
    s.button('保存并验证 HTTPS').click();
    await flush();
    expect(s.apiState.mappings).toEqual([
      { windowsRoot: 'E:/Images', webdavRoot: '' },
    ]);
    expect(s.api.updateNasSettings).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['Windows 根目录', (s: ReturnType<typeof setup>) => edit(s.textInput('Windows 根目录 1'), 'D:/Changed')],
    ['endpoint', (s: ReturnType<typeof setup>) => edit(s.textInput('WebDAV HTTPS 地址'), 'https://other.example:5006')],
    ['samplePaths', (s: ReturnType<typeof setup>) => edit(s.area('用于核对的现有图片路径'), 'D:/Sync/Sample/other.png')],
    ['WebDAV 目录', (s: ReturnType<typeof setup>) => edit(s.textInput('对应 WebDAV 目录'), '/Manually/Changed')],
  ])('does not apply a result after %s changes during discovery', async (_name, change) => {
    const s = setup();
    s.button('核对候选').click();
    await flush();
    change(s);
    s.discovery.resolve(result('/Stale/Candidate'));
    await flush();
    expect(s.api.updateNasSettings).toHaveBeenCalledTimes(1);
    expect(s.apiState.mappings[0]?.webdavRoot).toBe('');
  });

  it('does not apply or overwrite settings changed externally while discovery is pending', async () => {
    const s = setup();
    s.button('核对候选').click();
    await flush();
    s.apiState.endpoint = 'https://external.example:5006';
    s.discovery.resolve(result('/Stale/Candidate'));
    await flush();
    expect(s.api.updateNasSettings).toHaveBeenCalledTimes(1);
    expect(s.apiState.endpoint).toBe('https://external.example:5006');
    expect(s.apiState.mappings[0]?.webdavRoot).toBe('');
  });

  it('lets stop run during discovery and ignores its later success', async () => {
    const s = setup();
    s.button('核对候选').click();
    await flush();
    s.button('停止 NAS 并清空会话凭据').click();
    await flush();
    expect(s.api.disableNasImages).toHaveBeenCalledWith(true);
    s.discovery.resolve(result('/After/Stop'));
    await flush();
    expect(s.api.updateNasSettings).toHaveBeenCalledTimes(1);
    expect(s.apiState.mappings[0]?.webdavRoot).toBe('');
  });

  it('ignores a successful discovery that completes after the tab is hidden', async () => {
    const s = setup();
    s.button('核对候选').click();
    await flush();
    s.tab.hide();
    s.discovery.resolve(result('/After/Hide'));
    await flush();
    expect(s.api.updateNasSettings).toHaveBeenCalledTimes(1);
    expect(s.apiState.mappings[0]?.webdavRoot).toBe('');
  });

  it('keeps edits made while save is pending and does not start discovery', async () => {
    const s = setup();
    const save = deferred<void>();
    vi.mocked(s.api.updateNasSettings).mockReturnValueOnce(save.promise);
    const button = s.button('核对候选');
    button.click();
    await flush();
    s.apiState.endpoint = 'https://external.example:5006';
    edit(s.textInput('WebDAV HTTPS 地址'), 'https://edited.example:5006');
    save.resolve();
    await flush();
    expect(s.api.discoverNasMapping).not.toHaveBeenCalled();
    expect(s.textInput('WebDAV HTTPS 地址').value).toBe('https://edited.example:5006');
    expect(s.api.updateNasSettings).toHaveBeenCalledTimes(1);
    expect(s.apiState.endpoint).toBe('https://external.example:5006');
  });

  it('preserves pending-save edits for the next explicit save', async () => {
    const s = setup(), save = deferred<void>();
    vi.mocked(s.api.updateNasSettings).mockImplementationOnce(async (value: NasSettings) => {
      Object.assign(s.apiState, serializeNasSettings(value));
      await save.promise;
    });
    s.button('核对候选').click();
    await flush();
    edit(s.textInput('Windows 根目录 1'), 'D:/Edited');
    save.resolve();
    await flush();
    expect(s.api.discoverNasMapping).not.toHaveBeenCalled();
    s.button('保存并验证 HTTPS').click();
    await flush();
    expect(s.apiState.mappings[0]?.windowsRoot).toBe('D:/Edited');
    expect(s.apiState.mappings[0]?.webdavRoot).toBe('');
  });

  it('accepts an unchanged draft whose endpoint is normalized on save', async () => {
    const s = setup();
    edit(s.textInput('WebDAV HTTPS 地址'), 'https://nas.example:5006/');
    s.button('核对候选').click();
    await flush();
    expect(s.api.discoverNasMapping).toHaveBeenCalledWith(0);
    s.discovery.resolve(result('/Verified'));
    await flush();
    expect(s.apiState.endpoint).toBe('https://nas.example:5006');
    expect(s.apiState.mappings[0]?.webdavRoot).toBe('/Verified');
  });

  it.each(['incomplete','ambiguous'] as const)('does not auto-save an %s discovery', async outcome => {
    const s = setup();
    s.button('核对候选').click();
    await flush();
    const value = result();
    if(outcome==='incomplete')value.complete=false;
    else value.candidates.push({...value.candidates[0]!,webdavRoot:'/Other'});
    s.discovery.resolve(value);
    await flush();
    expect(s.api.updateNasSettings).toHaveBeenCalledTimes(1);
    expect(s.apiState.mappings[0]?.webdavRoot).toBe('');
  });
});
