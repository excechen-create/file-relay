# File Relay

An Obsidian plugin for stable external image links, distributed under the [MIT License](LICENSE).

~~~markdown
![Raman](nas://research/TaS2/Raman/001.png)
~~~

## Resource groups

Open **Settings → File Relay**. Add a group with a short name and its local image directory. Use the same name on every device where you open the note. Expand **WebDAV** to configure the equivalent HTTPS directory and choose an Obsidian Keychain entry. The local configuration stores only the name of the secret entry.

On desktop, paste a mapped path or paste or drop an image file to insert a logical link. For an unmapped external image, confirm the folder and name in the resource group dialog to save the mapping and insert the link. Canceling leaves the note unchanged. Vault attachments and non-image inputs follow Obsidian's normal workflow.

The default strategy checks the actual local file first and uses WebDAV when it cannot be read. PNG, JPEG and WebP are supported. A session cache deduplicates remote reads. Reading View and Live Preview use the native Obsidian image nodes.

## Install or update

In BRAT, add `excechen-create/file-relay` and track **Latest** to receive preview releases. Version 0.4.3 is the first preview with unified `nas://` resource groups.

Use official Adjustable Media 0.9.2 if you want its matrix and viewer. Its unmodified release passed the Windows compatibility tests, so AM can stay on its own official update channel. The compatibility build script is for the audited older AM 0.8.2 and 0.9.0 builds.

## Build from source

~~~powershell
npm ci
npm run verify
~~~

For manual installation, copy main.js, manifest.json and styles.css from the release or the dist directory into your vault's .obsidian/plugins/file-relay directory.

## HTTPS and platform scope

WebDAV uses read-only HTTPS with certificate validation and redirect rejection. For a private IPv4 endpoint, the desktop certificate settings can bind an explicitly verified public certificate fingerprint and DNS identity to that host and port. Enable the corresponding trust option in the resource group. Changing that certificate requires a new confirmation.

The plugin is desktop-only. Windows Obsidian has been exercised with local and loopback WebDAV files, native views, AM, and file paste and drop.

## Permissions and data

- **Files outside the Vault:** The plugin reads images from the external directories you configure, so the images can stay in their original location. The local backend checks that the resolved file is inside the configured directory.
- **Network and accounts:** WebDAV is optional. The plugin connects to the HTTPS WebDAV service you configure to read images or verify legacy mappings. An account is required if that service requires authentication. A saved Obsidian Keychain entry or session password is used for that service. The plugin sends no telemetry.
- **Notebook changes:** Bulk conversion and restoration require confirmation. Conversion edits image destinations and keeps the affected notes' original and converted text in device-local storage for the latest batch. Restore checks for later edits before writing and clears the recovery record after success.

The source tree includes only synthetic fixtures. Tests that require a separately installed audited AM bundle skip when it is absent.
