# nas address translator

An Obsidian plugin for stable external image links, distributed under the [MIT License](LICENSE).

~~~markdown
![Raman](nas://research/TaS2/Raman/001.png)
~~~

## Resource groups

Open **Settings → nas address translator**. Add a group with a short name and its local image directory. Use the same name on every device where you open the note. Expand **WebDAV** to configure the equivalent HTTPS directory and choose an Obsidian Keychain entry. The local configuration stores only the name of the secret entry.

On desktop, paste a mapped path or paste or drop an image file to insert a logical link. For an unmapped external image, confirm the folder and name in the resource group dialog to save the mapping and insert the link. Canceling leaves the note unchanged. Vault attachments and non-image inputs follow Obsidian's normal workflow.

The default strategy checks the actual local file first and uses WebDAV when it cannot be read. PNG, JPEG and WebP are supported. A session cache deduplicates remote reads. Reading View and Live Preview use the native Obsidian image nodes.

## Build and install

~~~powershell
npm ci
npm run verify
~~~

Install dist/main.js, dist/manifest.json and dist/styles.css in your vault's .obsidian/plugins/remote-nas-resource-adapter directory. The existing v0.4.1 preview release predates the unified resource groups. Build this source to try them.

For Adjustable Media, run npm run build:am-compat -- <path-to-original-main.js>. The helper accepts the audited 0.8.2 and 0.9.0 bundles by hash and emits dist/am-compat/main.js. Back up the original AM main.js before replacing it. This repository distributes the compatibility helper and no AM bundle.

## HTTPS and platform scope

WebDAV uses read-only HTTPS with certificate validation and redirect rejection. For a private IPv4 endpoint, the desktop certificate settings can bind an explicitly verified public certificate fingerprint and DNS identity to that host and port. Enable the corresponding trust option in the resource group. Changing that certificate requires a new confirmation.

Windows Obsidian has been exercised with local and loopback WebDAV files, native views, AM, and file paste and drop. The mobile path has mock coverage and needs real Android/iPad validation. It requires a device-trusted HTTPS certificate and CORS support for the Obsidian WebView.

The source tree includes only synthetic fixtures. Tests that require a separately installed audited AM bundle skip when it is absent.
