import { GoogleGenAI, Type } from '@google/genai';
import { ALLOWED_REPORT_CATEGORIES } from './matching.ts';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

export interface ExtractedMedicalDocument {
  patientName: string;
  hospitalRegNumber: string;
  patientIdHint: string;
  dateOfBirth: string;
  reportRefNumber: string;
  category: string;
  title: string;
  examinationDate: string;
  hospitalNameHint: string;
  departmentHint: string;
  reviewingDoctorHint: string;
  labValues: Array<{
    parameter: string;
    value: string;
    unit: string;
    referenceRange: string;
    flag: string;
  }>;
  missingFields: string[];
  administrativeSummary: string;
  confidenceScore: number;
}

const SYSTEM_INSTRUCTION = `You are a clinical document extraction assistant for MediReport Connect.
Your sole responsibility is OCR, structured administrative data extraction, and quality checking on uploaded medical reports.

STRICT SAFETY RULES:
1. NEVER diagnose a patient or state a confirmed medical diagnosis.
2. NEVER alter or fabricate medical findings, laboratory values, or reference ranges.
3. NEVER approve or release a medical report.
4. Keep the administrativeSummary purely descriptive (e.g., "Complete Blood Count document containing 6 hematology parameters from Examination Date 2026-11-12; missing patient date of birth.").
5. Map category strictly to one of: ${ALLOWED_REPORT_CATEGORIES.join(', ')}.
6. List any missing mandatory fields among: patientName, hospitalRegNumber, reportRefNumber, examinationDate, reviewingDoctorHint, category.`;

export async function extractMedicalReportWithGemini(params: {
  fileBase64?: string;
  mimeType?: string;
  rawText?: string;
  fileName?: string;
}): Promise<ExtractedMedicalDocument> {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

  if (params.fileBase64 && params.mimeType) {
    parts.push({
      inlineData: {
        mimeType: params.mimeType,
        data: params.fileBase64,
      },
    });
  }

  parts.push({
    text: `Extract structured administrative fields and laboratory/examination metrics from this medical report${
      params.fileName ? ` (filename: ${params.fileName})` : ''
    }.${params.rawText ? `\n\nProvided text content:\n${params.rawText}` : ''}`,
  });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: { parts },
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          patientName: { type: Type.STRING },
          hospitalRegNumber: { type: Type.STRING },
          patientIdHint: { type: Type.STRING },
          dateOfBirth: { type: Type.STRING },
          reportRefNumber: { type: Type.STRING },
          category: { type: Type.STRING },
          title: { type: Type.STRING },
          examinationDate: { type: Type.STRING },
          hospitalNameHint: { type: Type.STRING },
          departmentHint: { type: Type.STRING },
          reviewingDoctorHint: { type: Type.STRING },
          labValues: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                parameter: { type: Type.STRING },
                value: { type: Type.STRING },
                unit: { type: Type.STRING },
                referenceRange: { type: Type.STRING },
                flag: { type: Type.STRING },
              },
            },
          },
          missingFields: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          administrativeSummary: { type: Type.STRING },
          confidenceScore: { type: Type.INTEGER },
        },
      },
    },
  });

  const jsonText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(jsonText) as Partial<ExtractedMedicalDocument>;

  const normalizedCategory = ALLOWED_REPORT_CATEGORIES.includes(
    parsed.category as (typeof ALLOWED_REPORT_CATEGORIES)[number]
  )
    ? (parsed.category as string)
    : 'General laboratory reports';

  return {
    patientName: parsed.patientName || '',
    hospitalRegNumber: parsed.hospitalRegNumber || '',
    patientIdHint: parsed.patientIdHint || '',
    dateOfBirth: parsed.dateOfBirth || '',
    reportRefNumber: parsed.reportRefNumber || '',
    category: normalizedCategory,
    title: parsed.title || normalizedCategory,
    examinationDate: parsed.examinationDate || new Date().toISOString().slice(0, 10),
    hospitalNameHint: parsed.hospitalNameHint || '',
    departmentHint: parsed.departmentHint || '',
    reviewingDoctorHint: parsed.reviewingDoctorHint || '',
    labValues: Array.isArray(parsed.labValues) ? parsed.labValues : [],
    missingFields: Array.isArray(parsed.missingFields) ? parsed.missingFields : [],
    administrativeSummary:
      parsed.administrativeSummary ||
      'Administrative extraction completed. Physician verification required prior to patient release.',
    confidenceScore:
      typeof parsed.confidenceScore === 'number'
        ? Math.max(0, Math.min(100, parsed.confidenceScore))
        : 85,
  };
}
