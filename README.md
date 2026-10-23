# Opynyn

A daily question site for sharing on social media. Visitors pick one of two positions, see the vote, and discuss their reasoning. The admin page lets you queue future questions and remove comments.

## Run on Windows with Docker Desktop

1. Install and start Docker Desktop.
2. Open PowerShell in `C:\opynyn`.
3. Run `./setup.ps1`.
4. Open <http://localhost:3000>. The admin page is <http://localhost:3000/admin>.

The setup script creates `.env` with a random admin key, then builds and starts the container. Copy the `ADMIN_KEY` value from `.env` into the admin page. Keep `.env` private.

To stop: `docker compose down`. To start again: `docker compose up -d`. To see logs: `docker compose logs -f`. Updates to source need `docker compose up -d --build`.

Questions, votes, and comments live in the named Docker volume `opynyn_data` and survive container replacement. Avoid `docker compose down -v` unless you intend to delete the data. Back up the volume before moving to another machine.

The first seven questions are starter prompts. The first visit each day publishes the next available prompt. A question scheduled for a specific day takes priority on that day. The local day follows the `TZ` value in `.env` (default `America/Edmonton`). Past debates remain readable; voting and commenting close when the day ends.

Sharing copies or opens a link to the question. `localhost` links only work on your own computer. To invite people from social media, put this container behind a public HTTPS address, set `PUBLIC_URL` in `.env` to that address, and rebuild/restart. Use a domain and reverse proxy or a hosting provider; do not expose the admin key. If using a reverse proxy, forward the original `Host` header and HTTPS scheme.

This is a small community MVP. Voting is limited to one vote per browser cookie, so clearing cookies can create another vote. Comments are pseudonymous and have a 30-second posting delay. For a larger public audience, add stronger abuse protection and moderation before promoting it widely.

## Local development

Node 24 or newer is required. No package installation is needed. Set `ADMIN_KEY` to a long random value, then run `node server.mjs`. `npm test` runs the integration checks if npm is available; `node --test` works without it.
