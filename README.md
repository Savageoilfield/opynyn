# Opynyn

A daily question site for sharing on social media. Visitors pick one of two positions, see the vote, and discuss their reasoning. Visitors can report concerning comments; the admin portal provides a report queue, hide/restore moderation, question editing, aggregate daily summaries, and an activity log. See [ROADMAP.md](ROADMAP.md) for privacy, data licensing, and AdSense goals.

## Run on Windows

1. Open PowerShell in `C:\opynyn`.
2. Run `./setup.ps1`.
3. Open <http://localhost:3000>. The admin page is <http://localhost:3000/admin>.

The setup script creates `.env` with local settings. With Docker Desktop installed and running, it builds and starts the container. Otherwise it uses Node.js 24 or newer in the current PowerShell window; press Ctrl+C to stop.

Create the first admin account once with `node scripts/create-first-admin.mjs owner` from `C:\opynyn`. The script prints a temporary password once. Sign in at `/admin` and change it before using the dashboard. The account and hashed password live in the ignored SQLite database under `data/`; the password is never stored in Git. When using Docker, run `docker compose exec web node scripts/create-first-admin.mjs owner` instead.

To stop: `docker compose down`. To start again: `docker compose up -d`. To see logs: `docker compose logs -f`. Updates to source need `docker compose up -d --build`.

Questions, votes, and comments live in the ignored `data/` directory and survive restarts or switching between Node and Docker. Back up that directory before moving to another machine.

The first seven questions are starter prompts. The first visit each day publishes the next available prompt. A question scheduled for a specific day takes priority on that day. When the queue runs out, the oldest published question is reused as a new edition so the site keeps running; its previous votes and comments stay with the original edition. Add fresh prompts in the admin page to keep the conversation varied. The local day follows the `TZ` value in `.env` (default `America/Edmonton`). Past debates remain readable; voting and commenting close when the day ends.

Sharing copies or opens a link to the question. `localhost` links only work on your own computer. To invite people from social media, put this container behind a public HTTPS address, set `PUBLIC_URL` in `.env` to that address, and rebuild/restart. Use a domain and reverse proxy or a hosting provider; do not expose the admin key. If using a reverse proxy, forward the original `Host` header and HTTPS scheme.

This is a small community MVP. Voting is limited to one vote per browser cookie, so clearing cookies can create another vote. Comments are pseudonymous and have a 30-second posting delay. The admin portal uses a 12-hour, HTTP-only session cookie. For a larger public audience, add stronger abuse protection and moderation before promoting it widely.

## Local development

Node 24 or newer is required. No package installation is needed. Run `node server.mjs` after creating the first admin account. `npm test` runs the integration checks if npm is available; `node --test` works without it.
