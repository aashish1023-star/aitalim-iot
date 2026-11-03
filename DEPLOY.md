# Cloudflare deployment

This project serves the existing dashboard and replaces the legacy PHP/MySQL API with a Cloudflare Worker backed by D1 (SQLite).

## One-time setup

```powershell
npm install -D wrangler
npx wrangler login
npx wrangler d1 create aitalim-iot
```

Copy the returned `database_id` into `wrangler.toml`, then create the database tables:

```powershell
npx wrangler d1 execute aitalim-iot --remote --file=cloudflare/schema.sql
npx wrangler secret put ADMIN_USER
npx wrangler secret put ADMIN_PASSWORD
npx wrangler deploy
```

The final command prints the permanent free `https://aitalim-iot.<your-subdomain>.workers.dev` URL. Replace `SERVER_URL` in the ESP32 `.ino` files with that URL and reflash each device.

## GitHub

Create a GitHub repository without initializing it, then run:

```powershell
git init
git add .
git commit -m "Restore AITALIM IoT dashboard"
git branch -M main
git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-REPOSITORY.git
git push -u origin main
```

Do not force-push over an existing repository. `.gitignore` deliberately keeps old secrets out of the public repository.
