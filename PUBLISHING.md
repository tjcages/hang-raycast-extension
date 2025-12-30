# Publishing Guide

This guide covers:
1. Publishing the mono-repo to GitHub
2. Publishing the Raycast extension to the Raycast Store

## 1. Publishing to GitHub

### Step 1: Create a GitHub Repository

1. Go to https://github.com/new
2. Create a new repository (e.g., `hang` or `hang-monorepo`)
3. **Do NOT** initialize with README, .gitignore, or license (we already have these)
4. Click "Create repository"

### Step 2: Add Remote and Push

Once you have the repository URL, run:

```bash
# Add your GitHub remote (replace YOUR_USERNAME and REPO_NAME)
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git

# Or if using SSH:
git remote add origin git@github.com:YOUR_USERNAME/REPO_NAME.git

# Push to GitHub
git push -u origin main
```

## 2. Publishing Raycast Extension

The extension is located in `hang-extension/`. To publish:

### Step 1: Navigate to Extension Directory

```bash
cd hang-extension
```

### Step 2: Build and Test

```bash
# Build the extension
npm run build

# Test locally (optional)
npm run dev
```

### Step 3: Publish to Raycast Store

```bash
npm run publish
```

This will:
- Build the extension
- Upload it to the Raycast Store
- Prompt you to log in if needed
- Guide you through the publishing process

### Important Notes

- Make sure you're in the `hang-extension/` directory when running `npm run publish`
- The extension will be published under your Raycast account
- You may need to update the version in `hang-extension/package.json` if this is an update
- Check `hang-extension/CHANGELOG.md` to ensure it's up to date

## Updating the Extension

When you make changes:

1. Update `hang-extension/CHANGELOG.md` with your changes
2. Update version in `hang-extension/package.json` if needed
3. Commit changes to git
4. Push to GitHub
5. Publish from `hang-extension/` directory using `npm run publish`

