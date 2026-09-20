# TurboDownload Video Detector

This Manifest V3 extension detects actively playing, accessible HTML5 video resources in Chrome or Edge and forwards them to the running TurboDownload desktop app.

## Setup

1. Start TurboDownload and enable **Detect playing browser videos** in Settings.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer mode, choose **Load unpacked**, and select this `extension` folder.
4. In TurboDownload Settings > Browser video detector, select **Copy extension config**.
5. Open the extension's **Details > Extension options**, paste into **Copied config**, then select **Connect**.
6. Enable **Automatically download detected videos** in TurboDownload if you want eligible direct files to start without clicking Download.

The extension supports direct HTTP(S) MP4, WebM, and OGG resources, including direct video endpoints with no filename extension and many `blob:`-backed players whose direct media response is visible to the browser. HLS and DASH manifests are reported when exposed by the browser, but segmented downloads are not implemented.

The detector intentionally ignores encrypted/DRM media, HLS/DASH segments, credential extraction, paywall bypasses, CORS bypasses, and protected-media workflows. It forwards the page as a `Referer` for a direct-file download, but never extracts browser cookies or credentials.
