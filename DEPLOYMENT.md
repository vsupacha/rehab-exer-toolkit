# GitHub Pages deployment

Use this folder as the repository root. Publish `docs/`; no build or dependency installation is required.

## Connect an empty repository

Create a GitHub repository without an initial README, license or gitignore. From this folder, replace OWNER and REPOSITORY:

```powershell
git init -b main
git add .
git diff --cached --stat
git commit -m "Prepare Arm Booster for GitHub Pages"
git remote add origin https://github.com/OWNER/REPOSITORY.git
git push -u origin main
```

Review staged files before committing. If Git history or a remote already exists, inspect it before using these first-time commands. Keep participant photos, sensor exports and credentials out of the repository.

## Enable hosting

In Settings → Pages, select **Deploy from a branch**, **main**, **/docs**, then Save. Wait for deployment and use the HTTPS URL displayed by GitHub. Enable **Enforce HTTPS** when available.

- Game: `https://OWNER.github.io/REPOSITORY/game.html`
- Two-arm diagnostics: `https://OWNER.github.io/REPOSITORY/`

Keep `docs/.nojekyll`. Relative asset/module paths support repository subpaths. No custom domain, Actions workflow or backend is required.

## Validate and update

Open the game in desktop Chrome/Edge. Check styles and demo, then connect a real sensor, capture baseline and compare manual/game repetitions. Allow the camera, complete a goal and download/view the merged PNG. Check CSV export. Physical acceptance remains pending until verified on the actual setup.

Bluetooth and camera connect to the computer running the browser. HTTPS permits permission requests; browser/OS/device support and user permission are still required. Internet access is required to load the site; offline operation is not implemented. Photos and session data stay in browser memory and are not uploaded. Download wanted PNG/CSV before closing or refreshing.

Push updates to main, wait for deployment, then hard-refresh. Bump affected asset query versions when changing JS/CSS/modules.

Local preview from repository root:

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory docs
```

Open `http://localhost:8000/game.html`. Run `npm test` with Node 22+ for checks.

Official references: [publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site), [HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https).
