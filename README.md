## SurnMore

Standalone CRM and cold-email outreach application foundation. It is intentionally independent from the reference repository documented in `docs/`; no source code, runtime import, service, secret, storage bucket, or database is shared.

## Run locally

1. Copy `.env.example` to `.env.local` and provide values only for integrations you choose to enable.
2. Install dependencies with `npm install`.
3. Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Checks

```bash
npm run lint
npm run typecheck
```

## Structure

```text
app/        App Router routes, root layout, authenticated-route shell
components/ Product components and shared UI primitives
lib/        Framework-agnostic utilities and future auth/data adapters
database/   Owned schema, migrations, and database documentation
docs/       Source inventory, target architecture, gap register, manifest
```

The current application routes are visual, interaction-ready prototypes for Contacts, Companies, Inbox, Mailboxes, Sequences, and Administration. The workspace shell models authenticated navigation but does not connect an authentication provider or backend yet. See `docs/design-system.md`, `docs/visual-qa-checklist.md`, and `docs/backend-gap-register.md` before implementing durable product behavior.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
