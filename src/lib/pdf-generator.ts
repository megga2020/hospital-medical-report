import PDFDocument from 'pdfkit';

export interface ClinicalPdfPayload {
  reportRefNumber: string;
  title: string;
  category: string;
  status: string;
  version: number;
  examinationDate: string;
  uploadDate: string;
  hospitalName: string;
  hospitalLicense: string;
  branchName: string;
  departmentName: string;
  patientName: string;
  patientRefNumber: string;
  hospitalRegNumber: string;
  patientDob: string;
  reviewingDoctorName: string;
  reviewingDoctorLicense: string;
  clinicalNotes: string;
  administrativeSummary: string;
  labValues: Array<{
    parameter: string;
    value: string;
    unit: string;
    referenceRange: string;
    flag?: string;
  }>;
}

export async function generateClinicalReportPdf(data: ClinicalPdfPayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err: Error) => reject(err));

    // Top Header Band
    doc.rect(0, 0, doc.page.width, 86).fill('#0F172A');
    doc
      .fillColor('#FFFFFF')
      .fontSize(18)
      .font('Helvetica-Bold')
      .text(data.hospitalName, 48, 24);
    doc
      .fillColor('#94A3B8')
      .fontSize(9)
      .font('Helvetica')
      .text(
        `License: ${data.hospitalLicense}  |  Branch: ${data.branchName}  |  Department: ${data.departmentName}`,
        48,
        48
      );
    doc
      .fillColor('#2DD4BF')
      .fontSize(10)
      .font('Helvetica-Bold')
      .text(`REF: ${data.reportRefNumber} (v${data.version})`, 48, 64);

    doc.y = 108;

    // Report Title & Verification Status
    doc.fillColor('#0F172A').fontSize(15).font('Helvetica-Bold').text(data.title, 48);
    doc
      .fillColor('#0D9488')
      .fontSize(10)
      .font('Helvetica-Bold')
      .text(
        `Category: ${data.category}   |   Status: ${data.status.toUpperCase().replace(/_/g, ' ')}`,
        48,
        doc.y + 4
      );

    doc.moveDown(1);

    // Patient Metadata Box
    const boxY = doc.y;
    doc.roundedRect(48, boxY, 499, 76, 4).strokeColor('#CBD5E1').lineWidth(1).stroke();
    doc.fillColor('#475569').fontSize(8).font('Helvetica-Bold');
    doc.text('PATIENT FULL NAME', 60, boxY + 12);
    doc.text('PATIENT REF ID', 240, boxY + 12);
    doc.text('HOSPITAL REG NO.', 390, boxY + 12);

    doc.fillColor('#0F172A').fontSize(10).font('Helvetica');
    doc.text(data.patientName, 60, boxY + 24);
    doc.text(data.patientRefNumber, 240, boxY + 24);
    doc.text(data.hospitalRegNumber, 390, boxY + 24);

    doc.fillColor('#475569').fontSize(8).font('Helvetica-Bold');
    doc.text('DATE OF BIRTH', 60, boxY + 44);
    doc.text('EXAMINATION DATE', 240, boxY + 44);
    doc.text('REVIEWING PHYSICIAN', 390, boxY + 44);

    doc.fillColor('#0F172A').fontSize(10).font('Helvetica');
    doc.text(data.patientDob, 60, boxY + 56);
    doc.text(data.examinationDate, 240, boxY + 56);
    doc.text(data.reviewingDoctorName || 'Pending Assignment', 390, boxY + 56);

    doc.y = boxY + 94;

    // Lab Values Table
    if (data.labValues && data.labValues.length > 0) {
      doc.fillColor('#0F172A').fontSize(11).font('Helvetica-Bold').text('Diagnostic Findings & Measurements', 48);
      doc.moveDown(0.5);

      const startX = 48;
      let rowY = doc.y;
      doc.rect(startX, rowY, 499, 22).fill('#F1F5F9');
      doc.fillColor('#334155').fontSize(8).font('Helvetica-Bold');
      doc.text('PARAMETER', startX + 8, rowY + 7);
      doc.text('RESULT', startX + 200, rowY + 7);
      doc.text('UNIT', startX + 280, rowY + 7);
      doc.text('REFERENCE RANGE', startX + 355, rowY + 7);
      doc.text('FLAG', startX + 455, rowY + 7);

      rowY += 22;

      for (const item of data.labValues) {
        if (rowY > 710) {
          doc.addPage();
          rowY = 48;
        }
        doc
          .moveTo(startX, rowY + 20)
          .lineTo(startX + 499, rowY + 20)
          .strokeColor('#E2E8F0')
          .lineWidth(0.5)
          .stroke();

        doc.fillColor('#0F172A').fontSize(9).font('Helvetica');
        doc.text(item.parameter || '', startX + 8, rowY + 6, { width: 185 });
        doc.font('Helvetica-Bold').text(item.value || '', startX + 200, rowY + 6, { width: 75 });
        doc.font('Helvetica').text(item.unit || '', startX + 280, rowY + 6, { width: 70 });
        doc.text(item.referenceRange || '', startX + 355, rowY + 6, { width: 95 });
        doc
          .fillColor(item.flag && item.flag.toLowerCase() !== 'normal' ? '#DC2626' : '#0D9488')
          .text(item.flag || 'Normal', startX + 455, rowY + 6, { width: 40 });
        rowY += 22;
      }
      doc.y = rowY + 14;
    }

    // Clinical Notes
    if (data.clinicalNotes) {
      doc.fillColor('#0F172A').fontSize(11).font('Helvetica-Bold').text('Authorized Physician Notes', 48);
      doc.moveDown(0.3);
      doc.fillColor('#334155').fontSize(10).font('Helvetica').text(data.clinicalNotes, 48, doc.y, {
        width: 499,
      });
      doc.moveDown(1);
    }

    // Administrative Summary
    if (data.administrativeSummary) {
      doc.fillColor('#0F172A').fontSize(11).font('Helvetica-Bold').text('Administrative Record Summary', 48);
      doc.moveDown(0.3);
      doc.fillColor('#475569').fontSize(9).font('Helvetica').text(data.administrativeSummary, 48, doc.y, {
        width: 499,
      });
      doc.moveDown(1.2);
    }

    // Footer Seal
    const footerY = 760;
    doc
      .moveTo(48, footerY)
      .lineTo(547, footerY)
      .strokeColor('#CBD5E1')
      .lineWidth(0.5)
      .stroke();
    doc
      .fillColor('#64748B')
      .fontSize(8)
      .font('Helvetica')
      .text(
        `Verified Clinical Document  |  MediReport Connect  |  Physician License: ${
          data.reviewingDoctorLicense || 'N/A'
        }  |  Uploaded: ${data.uploadDate}`,
        48,
        footerY + 10
      );

    doc.end();
  });
}

export async function generateAdminSummaryPdf(params: {
  title: string;
  hospitalName: string;
  generatedAt: string;
  metrics: Array<{ label: string; value: string }>;
  rows: Array<{ ref: string; patient: string; category: string; status: string; date: string }>;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err: Error) => reject(err));

    doc.fillColor('#0F172A').fontSize(16).font('Helvetica-Bold').text(params.title, 48, 48);
    doc
      .fillColor('#475569')
      .fontSize(10)
      .font('Helvetica')
      .text(`${params.hospitalName}  ·  Generated ${params.generatedAt}`, 48, 70);

    doc.moveDown(1.5);
    for (const m of params.metrics) {
      doc.fillColor('#0F172A').fontSize(10).font('Helvetica-Bold').text(`${m.label}: `, { continued: true });
      doc.font('Helvetica').text(m.value);
    }

    doc.moveDown(1.2);
    doc.fontSize(11).font('Helvetica-Bold').text('Report Delivery Ledger', 48);
    doc.moveDown(0.5);

    let y = doc.y;
    for (const r of params.rows.slice(0, 30)) {
      if (y > 750) {
        doc.addPage();
        y = 48;
      }
      doc
        .fillColor('#334155')
        .fontSize(9)
        .font('Helvetica')
        .text(`${r.ref}  |  ${r.patient}  |  ${r.category}  |  ${r.status}  |  ${r.date}`, 48, y);
      y += 16;
    }

    doc.end();
  });
}
