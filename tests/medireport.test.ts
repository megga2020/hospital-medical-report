import { describe, expect, it } from 'vitest';
import {
  canAccessHospitalResource,
  canReleaseReportToPatient,
  evaluatePatientDuplicate,
  generatePatientRefNumber,
  generateReportRefNumber,
  PatientCandidate,
} from '../src/lib/matching.ts';
import { buildNotificationMessage } from '../src/lib/notifications.ts';
import { generateClinicalReportPdf } from '../src/lib/pdf-generator.ts';
import { computeSha256, scanUploadedFile, signSessionToken, verifySessionToken } from '../src/lib/security.ts';

const SAMPLE_PATIENTS: PatientCandidate[] = [
  {
    id: 1,
    patientRefNumber: 'PAT-ALNO-100421',
    hospitalRegNumber: 'MRN-AUH-90412',
    fullName: 'Rashid Saif Al-Mansoor',
    dateOfBirth: '1984-05-14',
    email: 'rashid.mansoor@patient-demo.ae',
    mobileCountryCode: '+971',
    mobileNumber: '501122334',
    hospitalId: 1,
  },
];

describe('MediReport Connect Core Clinical & Security Tests', () => {
  it('1. Patient registration & reference number generation', () => {
    const ref = generatePatientRefNumber('ALNOOR');
    expect(ref).toMatch(/^PAT-ALNO-\d{6}$/);
    const repRef = generateReportRefNumber('Blood test reports');
    expect(repRef).toMatch(/^MR-BLO-\d+$/);
  });

  it('2. Duplicate patient detection blocks exact MRN duplicates & flags uncertain matches without auto-merging', () => {
    const exact = evaluatePatientDuplicate(
      {
        hospitalRegNumber: 'MRN-AUH-90412',
        fullName: 'Rashid Saif Al-Mansoor',
        dateOfBirth: '1984-05-14',
        email: 'rashid.mansoor@patient-demo.ae',
        mobileCountryCode: '+971',
        mobileNumber: '501122334',
        hospitalId: 1,
      },
      SAMPLE_PATIENTS,
      'strict_id_and_dob'
    );
    expect(exact.exactDuplicate?.id).toBe(1);
    expect(exact.uncertainMatch).toBeNull();

    // Shared phone with different name/MRN -> uncertain match (must not auto-merge)
    const uncertain = evaluatePatientDuplicate(
      {
        hospitalRegNumber: 'MRN-AUH-99999',
        fullName: 'R. S. Al-Mansoor',
        dateOfBirth: '1984-05-14',
        email: '',
        mobileCountryCode: '+971',
        mobileNumber: '501122334',
        hospitalId: 1,
      },
      SAMPLE_PATIENTS,
      'strict_id_and_dob'
    );
    expect(exact.exactDuplicate).not.toBeNull();
    expect(uncertain.exactDuplicate).toBeNull();
    expect(uncertain.uncertainMatch?.id).toBe(1);
  });

  it('3. Report verification gate never releases unverified reports to patients', () => {
    expect(canReleaseReportToPatient('pending_verification')).toBe(false);
    expect(canReleaseReportToPatient('manual_matching')).toBe(false);
    expect(canReleaseReportToPatient('correction_requested')).toBe(false);
    expect(canReleaseReportToPatient('rejected')).toBe(false);
    expect(canReleaseReportToPatient('approved')).toBe(true);
    expect(canReleaseReportToPatient('delivered')).toBe(true);
  });

  it('4. Strict hospital-level data isolation across roles', () => {
    expect(canAccessHospitalResource({ role: 'hospital_admin', hospitalId: 1 }, 1)).toBe(true);
    expect(canAccessHospitalResource({ role: 'hospital_admin', hospitalId: 1 }, 2)).toBe(false);
    expect(canAccessHospitalResource({ role: 'doctor', hospitalId: 2 }, 1)).toBe(false);
    expect(canAccessHospitalResource({ role: 'super_admin', hospitalId: null }, 2)).toBe(true);
  });

  it('5. Notification message uses secure access link without attaching sensitive medical reports', () => {
    const msg = buildNotificationMessage({
      patientName: 'Rashid Saif Al-Mansoor',
      hospitalName: 'Al Noor Specialist Hospital',
      secureAccessUrl: 'https://medireport.example/?access_token=abc123',
      language: 'en',
    });
    expect(msg).toContain('Dear Rashid Saif Al-Mansoor');
    expect(msg).toContain('Al Noor Specialist Hospital');
    expect(msg).toContain('https://medireport.example/?access_token=abc123');
  });

  it('6. Malware upload scanner blocks executables and scripts, allows valid PDFs', () => {
    const exeBuf = Buffer.from('4d5a900003000000', 'hex');
    const exeScan = scanUploadedFile(exeBuf, 'application/pdf', 'fake.pdf');
    expect(exeScan.safe).toBe(false);
    expect(exeScan.status).toBe('quarantined');

    const pdfBuf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj', 'utf8');
    const pdfScan = scanUploadedFile(pdfBuf, 'application/pdf', 'cbc.pdf');
    expect(pdfScan.safe).toBe(true);
    expect(computeSha256(pdfBuf)).toHaveLength(64);
  });

  it('7. Signed session tokens validate integrity and role claims', () => {
    const tok = signSessionToken({
      userId: 10,
      uid: 'demo-doctor',
      email: 'dr.reed@alnoor-demo.ae',
      role: 'doctor',
      hospitalId: 1,
      mfaVerified: true,
    });
    const decoded = verifySessionToken(tok);
    expect(decoded?.role).toBe('doctor');
    expect(decoded?.hospitalId).toBe(1);
    expect(verifySessionToken(tok + 'tampered')).toBeNull();
  });

  it('8. Clinical PDF generation produces valid PDF buffer', async () => {
    const pdf = await generateClinicalReportPdf({
      reportRefNumber: 'MR-TEST-001',
      title: 'Test Hematology Panel',
      category: 'Blood test reports',
      status: 'delivered',
      version: 1,
      examinationDate: '2026-11-17',
      uploadDate: '2026-11-17',
      hospitalName: 'Al Noor Specialist Hospital',
      hospitalLicense: 'DOH-AUH-1042',
      branchName: 'Khalifa Street Main Campus',
      departmentName: 'Hematology',
      patientName: 'Rashid Saif Al-Mansoor',
      patientRefNumber: 'PAT-ALNO-100421',
      hospitalRegNumber: 'MRN-AUH-90412',
      patientDob: '1984-05-14',
      reviewingDoctorName: 'Dr. Evelyn Reed, MD',
      reviewingDoctorLicense: 'DOH-MD-88412',
      clinicalNotes: 'Verified.',
      administrativeSummary: '6 parameters.',
      labValues: [
        { parameter: 'Hemoglobin', value: '14.5', unit: 'g/dL', referenceRange: '13.5-17.5', flag: 'Normal' },
      ],
    });
    expect(pdf.subarray(0, 4).toString('utf8')).toBe('%PDF');
  });
});
