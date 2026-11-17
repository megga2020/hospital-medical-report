# MediReport Connect

Hospital medical report collection, Google Gemini AI document extraction, physician verification workflow, and automatic multi-channel patient delivery platform.

## Architecture

- **Frontend**: React 19, TypeScript, Tailwind CSS v4 (`Plus Jakarta Sans` + `DM Sans` + `JetBrains Mono`), bilingual English & Arabic (`dir="rtl"`).
- **Backend**: Node.js + Express (`server.ts`) serving REST APIs and Vite/static frontend on port `3000`.
- **Database**: Cloud SQL PostgreSQL with Drizzle ORM (`src/db/schema.ts`, `src/db/index.ts`).
- **Authentication**: Firebase Authentication (Google Sign-In) + server-signed HMAC session tokens + 6-digit MFA verification for privileged roles (`super_admin`, `hospital_admin`, `doctor`).
- **AI Processing**: Server-side `@google/genai` (`gemini-4-hydrogen`) for OCR, missing-field detection, and administrative summaries (strictly non-diagnostic).
- **PDF Generation**: `pdfkit` clinical report PDFs & administrative audit exports.
- **Notifications**: Email (Resend API), WhatsApp Business Cloud API, and SMS (Twilio) with safe Sandbox Mode when gateway credentials are unset.

## Environment Variables

See `.env.example`:
- `GEMINI_API_KEY`: Google Gemini API key (server-side only).
- `APP_URL`: Hosted application URL for secure expiring patient links.
- `SQL_HOST`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD`: Managed automatically by Cloud SQL integration.
- Optional gateway credentials: `RESEND_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.

## Commands

```bash
npm install
npm run lint
npm test
npm run build
npm run dev
```

## Key API Endpoints

- `POST /api/auth/firebase` — Verify Firebase ID token and create/sync PostgreSQL user session.
- `POST /api/auth/demo-login` — Launch synthetic role workspace with MFA verification.
- `POST /api/auth/patient-register` — Patient self-registration with consent logging.
- `GET/POST /api/patients` — Hospital-scoped patient directory with configurable duplicate detection.
- `POST /api/patients/:id/resolve-duplicate` — Manual verification resolution (distinct vs. manual merge).
- `POST /api/reports/ai-extract` — Gemini AI OCR & administrative extraction on PDF/JPG/PNG/text.
- `GET/POST /api/reports` — Report collection, filtering, malware scanning, and storage.
- `POST /api/integrations/lims/reports` — External LIMS/HMS REST webhook ingestion.
- `POST /api/reports/:id/verify` — Physician verification (`approved`, `correction_requested`, `rejected`) + automatic multi-channel patient delivery.
- `GET /api/reports/:id/download` — RBAC-protected clinical PDF download.
- `POST /api/access/verify` — Expiring link DOB verification for patient report unlock.
- `GET /api/notifications` & `POST /api/notifications/:id/retry` — Delivery tracking & retries.
- `GET /api/analytics/dashboard` & `GET /api/analytics/export` — Hospital KPIs and CSV/PDF exports.
