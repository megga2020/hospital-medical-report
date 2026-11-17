export type UserRole =
  | 'super_admin'
  | 'hospital_admin'
  | 'lab_staff'
  | 'doctor'
  | 'reception_staff'
  | 'patient';

export type DuplicateMatchRule =
  | 'strict_id_and_dob'
  | 'fuzzy_name_and_phone'
  | 'email_or_reg_number';

export interface PatientCandidate {
  id: number;
  patientRefNumber: string;
  hospitalRegNumber: string;
  fullName: string;
  dateOfBirth: string;
  email: string;
  mobileCountryCode: string;
  mobileNumber: string;
  hospitalId: number;
}

export interface DuplicateCheckResult {
  exactDuplicate: PatientCandidate | null;
  uncertainMatch: PatientCandidate | null;
  reason: string;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePhone(code: string, phone: string): string {
  return `${code}${phone}`.replace(/[^0-9+]/g, '');
}

export function evaluatePatientDuplicate(
  incoming: {
    hospitalRegNumber: string;
    fullName: string;
    dateOfBirth: string;
    email?: string;
    mobileCountryCode: string;
    mobileNumber: string;
    hospitalId: number;
  },
  existingPatients: PatientCandidate[],
  rule: DuplicateMatchRule = 'strict_id_and_dob'
): DuplicateCheckResult {
  const scoped = existingPatients.filter((p) => p.hospitalId === incoming.hospitalId);
  const incomingReg = normalizeText(incoming.hospitalRegNumber);
  const incomingName = normalizeText(incoming.fullName);
  const incomingPhone = normalizePhone(incoming.mobileCountryCode, incoming.mobileNumber);
  const incomingEmail = incoming.email ? normalizeText(incoming.email) : '';

  for (const candidate of scoped) {
    const candReg = normalizeText(candidate.hospitalRegNumber);
    const candName = normalizeText(candidate.fullName);
    const candPhone = normalizePhone(candidate.mobileCountryCode, candidate.mobileNumber);
    const candEmail = candidate.email ? normalizeText(candidate.email) : '';

    // Exact Hospital Registration Number match -> definite duplicate
    if (incomingReg && candReg === incomingReg) {
      return {
        exactDuplicate: candidate,
        uncertainMatch: null,
        reason: `Hospital registration number ${candidate.hospitalRegNumber} already exists.`,
      };
    }

    if (rule === 'strict_id_and_dob') {
      if (candName === incomingName && candidate.dateOfBirth === incoming.dateOfBirth) {
        return {
          exactDuplicate: candidate,
          uncertainMatch: null,
          reason: `Exact match on full name and date of birth with ${candidate.patientRefNumber}.`,
        };
      }
      if (
        (candPhone && incomingPhone && candPhone === incomingPhone) ||
        (candEmail && incomingEmail && candEmail === incomingEmail)
      ) {
        return {
          exactDuplicate: null,
          uncertainMatch: candidate,
          reason: `Shared phone or email with ${candidate.fullName} (${candidate.patientRefNumber}). Requires manual verification.`,
        };
      }
    } else if (rule === 'fuzzy_name_and_phone') {
      if (candPhone === incomingPhone && candName === incomingName) {
        return {
          exactDuplicate: candidate,
          uncertainMatch: null,
          reason: `Exact match on name and mobile number with ${candidate.patientRefNumber}.`,
        };
      }
      if (candPhone === incomingPhone || (candName === incomingName && candidate.dateOfBirth !== incoming.dateOfBirth)) {
        return {
          exactDuplicate: null,
          uncertainMatch: candidate,
          reason: `Potential match with ${candidate.fullName} (${candidate.patientRefNumber}) — queued for manual verification.`,
        };
      }
    } else if (rule === 'email_or_reg_number') {
      if (incomingEmail && candEmail && candEmail === incomingEmail) {
        return {
          exactDuplicate: candidate,
          uncertainMatch: null,
          reason: `Email address already registered under ${candidate.patientRefNumber}.`,
        };
      }
      if (candName === incomingName && candidate.dateOfBirth === incoming.dateOfBirth) {
        return {
          exactDuplicate: null,
          uncertainMatch: candidate,
          reason: `Matching name and DOB with ${candidate.patientRefNumber} — queued for manual verification.`,
        };
      }
    }
  }

  return { exactDuplicate: null, uncertainMatch: null, reason: 'No duplicate detected.' };
}

export function canAccessHospitalResource(
  actor: { role: string; hospitalId: number | null },
  targetHospitalId: number
): boolean {
  if (actor.role === 'super_admin') return true;
  if (actor.hospitalId === null) return false;
  return actor.hospitalId === targetHospitalId;
}

export function canReleaseReportToPatient(reportStatus: string): boolean {
  return reportStatus === 'approved' || reportStatus === 'delivered';
}

export const ALLOWED_REPORT_CATEGORIES = [
  'Blood test reports',
  'Urine test reports',
  'X-ray reports',
  'MRI reports',
  'CT scan reports',
  'Ultrasound reports',
  'ECG reports',
  'Histopathology reports',
  'General laboratory reports',
  'Medical examination reports',
] as const;

export function generatePatientRefNumber(hospitalCode: string): string {
  const randomDigits = Math.floor(100000 + Math.random() * 900000);
  return `PAT-${hospitalCode.toUpperCase().slice(0, 4)}-${randomDigits}`;
}

export function generateReportRefNumber(category: string): string {
  const prefix = category.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3) || 'REP';
  const ts = Date.now().toString().slice(-5);
  const rand = Math.floor(100 + Math.random() * 900);
  return `MR-${prefix}-${ts}${rand}`;
}
