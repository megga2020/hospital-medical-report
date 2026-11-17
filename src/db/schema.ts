import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// 1. Hospitals
export const hospitals = pgTable('hospitals', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  nameAr: text('name_ar').notNull().default(''),
  code: text('code').notNull().unique(),
  licenseNumber: text('license_number').notNull(),
  emiratesJurisdiction: text('emirates_jurisdiction').notNull().default('UAE-DOH'),
  city: text('city').notNull().default('Abu Dhabi'),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  duplicateMatchRule: text('duplicate_match_rule').notNull().default('strict_id_and_dob'),
  retentionDays: integer('retention_days').notNull().default(3650),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 2. Hospital Branches
export const hospitalBranches = pgTable('hospital_branches', {
  id: serial('id').primaryKey(),
  hospitalId: integer('hospital_id')
    .references(() => hospitals.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  nameAr: text('name_ar').notNull().default(''),
  code: text('code').notNull(),
  city: text('city').notNull(),
  address: text('address').notNull(),
  phone: text('phone').notNull().default(''),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 3. Departments
export const departments = pgTable('departments', {
  id: serial('id').primaryKey(),
  hospitalId: integer('hospital_id')
    .references(() => hospitals.id, { onDelete: 'cascade' })
    .notNull(),
  branchId: integer('branch_id').references(() => hospitalBranches.id, {
    onDelete: 'set null',
  }),
  name: text('name').notNull(),
  nameAr: text('name_ar').notNull().default(''),
  code: text('code').notNull(),
  headDoctorName: text('head_doctor_name').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 4. Users (linked to Firebase Auth UID + RBAC)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  fullName: text('full_name').notNull().default('Clinical User'),
  role: text('role').notNull().default('patient'),
  hospitalId: integer('hospital_id').references(() => hospitals.id, {
    onDelete: 'set null',
  }),
  branchId: integer('branch_id').references(() => hospitalBranches.id, {
    onDelete: 'set null',
  }),
  departmentId: integer('department_id').references(() => departments.id, {
    onDelete: 'set null',
  }),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  mfaCode: text('mfa_code').notNull().default('482910'),
  language: text('language').notNull().default('en'),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 5. Doctors
export const doctors = pgTable('doctors', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  hospitalId: integer('hospital_id')
    .references(() => hospitals.id, { onDelete: 'cascade' })
    .notNull(),
  branchId: integer('branch_id').references(() => hospitalBranches.id, {
    onDelete: 'set null',
  }),
  departmentId: integer('department_id').references(() => departments.id, {
    onDelete: 'set null',
  }),
  fullName: text('full_name').notNull(),
  licenseNumber: text('license_number').notNull(),
  specialty: text('specialty').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull().default(''),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 6. Laboratories
export const laboratories = pgTable('laboratories', {
  id: serial('id').primaryKey(),
  hospitalId: integer('hospital_id')
    .references(() => hospitals.id, { onDelete: 'cascade' })
    .notNull(),
  branchId: integer('branch_id').references(() => hospitalBranches.id, {
    onDelete: 'set null',
  }),
  name: text('name').notNull(),
  code: text('code').notNull(),
  accreditation: text('accreditation').notNull().default('CAP / ISO 15189'),
  limsIntegrationType: text('lims_integration_type').notNull().default('HL7/FHIR REST'),
  apiKeyPrefix: text('api_key_prefix').notNull().default('mr_live_'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 7. Patients
export const patients = pgTable('patients', {
  id: serial('id').primaryKey(),
  patientRefNumber: text('patient_ref_number').notNull().unique(),
  hospitalRegNumber: text('hospital_reg_number').notNull(),
  fullName: text('full_name').notNull(),
  dateOfBirth: text('date_of_birth').notNull(),
  gender: text('gender').notNull(),
  email: text('email').notNull().default(''),
  mobileCountryCode: text('mobile_country_code').notNull().default('+971'),
  mobileNumber: text('mobile_number').notNull(),
  hospitalId: integer('hospital_id')
    .references(() => hospitals.id, { onDelete: 'cascade' })
    .notNull(),
  branchId: integer('branch_id').references(() => hospitalBranches.id, {
    onDelete: 'set null',
  }),
  departmentId: integer('department_id').references(() => departments.id, {
    onDelete: 'set null',
  }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  consentStatus: text('consent_status').notNull().default('granted'),
  needsManualVerification: boolean('needs_manual_verification').notNull().default(false),
  duplicateCandidateId: integer('duplicate_candidate_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 8. Patient Consents
export const patientConsents = pgTable('patient_consents', {
  id: serial('id').primaryKey(),
  patientId: integer('patient_id')
    .references(() => patients.id, { onDelete: 'cascade' })
    .notNull(),
  hospitalId: integer('hospital_id')
    .references(() => hospitals.id, { onDelete: 'cascade' })
    .notNull(),
  consentType: text('consent_type').notNull().default('digital_report_delivery'),
  status: text('status').notNull().default('granted'),
  notes: text('notes').notNull().default(''),
  recordedByUserId: integer('recorded_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  grantedAt: timestamp('granted_at').defaultNow().notNull(),
  revokedAt: timestamp('revoked_at'),
});

// 9. Notification Preferences
export const notificationPreferences = pgTable('notification_preferences', {
  id: serial('id').primaryKey(),
  patientId: integer('patient_id')
    .references(() => patients.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  emailEnabled: boolean('email_enabled').notNull().default(true),
  whatsappEnabled: boolean('whatsapp_enabled').notNull().default(true),
  smsEnabled: boolean('sms_enabled').notNull().default(false),
  preferredChannel: text('preferred_channel').notNull().default('email'),
  preferredLanguage: text('preferred_language').notNull().default('en'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 10. Medical Reports
export const medicalReports = pgTable('medical_reports', {
  id: serial('id').primaryKey(),
  reportRefNumber: text('report_ref_number').notNull().unique(),
  patientId: integer('patient_id').references(() => patients.id, {
    onDelete: 'set null',
  }),
  hospitalId: integer('hospital_id')
    .references(() => hospitals.id, { onDelete: 'cascade' })
    .notNull(),
  branchId: integer('branch_id').references(() => hospitalBranches.id, {
    onDelete: 'set null',
  }),
  departmentId: integer('department_id').references(() => departments.id, {
    onDelete: 'set null',
  }),
  laboratoryId: integer('laboratory_id').references(() => laboratories.id, {
    onDelete: 'set null',
  }),
  reviewingDoctorId: integer('reviewing_doctor_id').references(() => doctors.id, {
    onDelete: 'set null',
  }),
  uploadedByUserId: integer('uploaded_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  category: text('category').notNull(),
  title: text('title').notNull(),
  examinationDate: text('examination_date').notNull(),
  uploadDate: timestamp('upload_date').defaultNow().notNull(),
  sourceChannel: text('source_channel').notNull().default('pdf_upload'),
  status: text('status').notNull().default('pending_verification'),
  aiExtractedData: jsonb('ai_extracted_data').$type<Record<string, unknown>>(),
  aiAdministrativeSummary: text('ai_administrative_summary').notNull().default(''),
  aiMissingFields: jsonb('ai_missing_fields').$type<string[]>(),
  aiConfidenceScore: integer('ai_confidence_score').notNull().default(0),
  labValues: jsonb('lab_values').$type<
    Array<{
      parameter: string;
      value: string;
      unit: string;
      referenceRange: string;
      flag?: string;
    }>
  >(),
  clinicalNotes: text('clinical_notes').notNull().default(''),
  version: integer('version').notNull().default(1),
  isDuplicateFlagged: boolean('is_duplicate_flagged').notNull().default(false),
  duplicateOfReportId: integer('duplicate_of_report_id'),
  patientMatchedUncertain: boolean('patient_matched_uncertain').notNull().default(false),
  reminderSentAt: timestamp('reminder_sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 11. Report Attachments
export const reportAttachments = pgTable('report_attachments', {
  id: serial('id').primaryKey(),
  reportId: integer('report_id')
    .references(() => medicalReports.id, { onDelete: 'cascade' })
    .notNull(),
  version: integer('version').notNull().default(1),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSizeBytes: integer('file_size_bytes').notNull(),
  sha256Checksum: text('sha256_checksum').notNull(),
  malwareScanStatus: text('malware_scan_status').notNull().default('clean'),
  fileDataBase64: text('file_data_base64').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 12. Report Approvals & Version History
export const reportApprovals = pgTable('report_approvals', {
  id: serial('id').primaryKey(),
  reportId: integer('report_id')
    .references(() => medicalReports.id, { onDelete: 'cascade' })
    .notNull(),
  reviewerUserId: integer('reviewer_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  reviewerDoctorId: integer('reviewer_doctor_id').references(() => doctors.id, {
    onDelete: 'set null',
  }),
  action: text('action').notNull(),
  clinicalComments: text('clinical_comments').notNull().default(''),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 13. Signed & Expiring Report Access Tokens
export const reportAccessTokens = pgTable('report_access_tokens', {
  id: serial('id').primaryKey(),
  reportId: integer('report_id')
    .references(() => medicalReports.id, { onDelete: 'cascade' })
    .notNull(),
  patientId: integer('patient_id')
    .references(() => patients.id, { onDelete: 'cascade' })
    .notNull(),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  accessCount: integer('access_count').notNull().default(0),
  lastAccessedAt: timestamp('last_accessed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 14. Patient Report Sharing with Authorised Doctors
export const reportShares = pgTable('report_shares', {
  id: serial('id').primaryKey(),
  reportId: integer('report_id')
    .references(() => medicalReports.id, { onDelete: 'cascade' })
    .notNull(),
  patientId: integer('patient_id')
    .references(() => patients.id, { onDelete: 'cascade' })
    .notNull(),
  sharedWithDoctorId: integer('shared_with_doctor_id').references(() => doctors.id, {
    onDelete: 'set null',
  }),
  sharedWithEmail: text('shared_with_email').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 15. Notifications
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  reportId: integer('report_id')
    .references(() => medicalReports.id, { onDelete: 'cascade' })
    .notNull(),
  patientId: integer('patient_id')
    .references(() => patients.id, { onDelete: 'cascade' })
    .notNull(),
  hospitalId: integer('hospital_id')
    .references(() => hospitals.id, { onDelete: 'cascade' })
    .notNull(),
  channel: text('channel').notNull(),
  recipient: text('recipient').notNull(),
  messageBody: text('message_body').notNull(),
  secureAccessUrl: text('secure_access_url').notNull(),
  status: text('status').notNull().default('queued'),
  retryCount: integer('retry_count').notNull().default(0),
  maxRetries: integer('max_retries').notNull().default(3),
  nextRetryAt: timestamp('next_retry_at'),
  providerMessageId: text('provider_message_id').notNull().default(''),
  errorMessage: text('error_message').notNull().default(''),
  patientAccessedAt: timestamp('patient_accessed_at'),
  patientDownloadedAt: timestamp('patient_downloaded_at'),
  sentAt: timestamp('sent_at'),
  deliveredAt: timestamp('delivered_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 16. Notification & Platform Settings
export const notificationSettings = pgTable('notification_settings', {
  id: serial('id').primaryKey(),
  hospitalId: integer('hospital_id')
    .references(() => hospitals.id, { onDelete: 'cascade' })
    .unique(),
  emailProvider: text('email_provider').notNull().default('sandbox'),
  whatsappEnabled: boolean('whatsapp_enabled').notNull().default(true),
  smsProvider: text('sms_provider').notNull().default('sandbox'),
  maxRetries: integer('max_retries').notNull().default(3),
  retryDelayMinutes: integer('retry_delay_minutes').notNull().default(15),
  pendingReminderHours: integer('pending_reminder_hours').notNull().default(12),
  sandboxMode: boolean('sandbox_mode').notNull().default(true),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 17. Subscriptions & Billing
export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),
  hospitalId: integer('hospital_id')
    .references(() => hospitals.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  planTier: text('plan_tier').notNull().default('clinical_pro'),
  monthlyPriceAed: integer('monthly_price_aed').notNull().default(4500),
  maxReportsPerMonth: integer('max_reports_per_month').notNull().default(10000),
  reportsUsedThisMonth: integer('reports_used_this_month').notNull().default(0),
  billingCycle: text('billing_cycle').notNull().default('monthly'),
  status: text('status').notNull().default('active'),
  nextBillingDate: text('next_billing_date').notNull().default('2026-12-01'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 18. Audit Logs
export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  hospitalId: integer('hospital_id').references(() => hospitals.id, {
    onDelete: 'set null',
  }),
  actorUserId: integer('actor_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  actorEmail: text('actor_email').notNull().default('system'),
  actorRole: text('actor_role').notNull().default('system'),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id').notNull().default(''),
  details: jsonb('details').$type<Record<string, unknown>>(),
  ipAddress: text('ip_address').notNull().default('127.0.0.1'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Relations
export const hospitalsRelations = relations(hospitals, ({ many, one }) => ({
  branches: many(hospitalBranches),
  departments: many(departments),
  patients: many(patients),
  reports: many(medicalReports),
  subscription: one(subscriptions),
}));

export const patientsRelations = relations(patients, ({ one, many }) => ({
  hospital: one(hospitals, {
    fields: [patients.hospitalId],
    references: [hospitals.id],
  }),
  preferences: one(notificationPreferences),
  reports: many(medicalReports),
  consents: many(patientConsents),
}));

export const medicalReportsRelations = relations(medicalReports, ({ one, many }) => ({
  patient: one(patients, {
    fields: [medicalReports.patientId],
    references: [patients.id],
  }),
  hospital: one(hospitals, {
    fields: [medicalReports.hospitalId],
    references: [hospitals.id],
  }),
  attachments: many(reportAttachments),
  approvals: many(reportApprovals),
  notifications: many(notifications),
}));
