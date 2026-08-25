/**
 * ApplicationData — the single normalized model.
 *
 * This one shape drives: form state, validation, the review screen, and (from Phase 4)
 * DOCX population and PDF generation. There is deliberately no second "Word-shaped" model.
 *
 * Word `w:id` knowledge lives ONLY in js/schema.js (`controls:` keys) and, from Phase 4,
 * in templates/<version>/mapping.json. Nothing in this file references Word.
 *
 * Referenced from plain JS via  `@typedef {import('../types/application-data').ApplicationData}`
 * so the editor type-checks without a build step. `npx tsc --noEmit -p .` validates it.
 */

export type StandardKey = 'ocs' | 'gots' | 'ivnBest' | 'grs' | 'rcs' | 'raf' | 'rds';
export type RafSubStandard = 'rws' | 'rms' | 'ras';
export type CertStatus = 'initial' | 'renewal';
export type YesNo = 'yes' | 'no';
export type Currency =
  | 'USD' | 'RMB' | 'EURO' | 'TWD' | 'TRY' | 'CHF' | 'INR'
  | 'BDT' | 'JPY' | 'PKR' | 'KRW' | 'IDR' | 'VND' | 'OTHER';
export type UnitType = 'main' | 'facility' | 'associatedSubcontractor' | 'certifiedSubcontractor';
export type RecycledMaterialType = 'none' | 'postConsumer' | 'preConsumer' | 'both';
export type RdsScope = 'slaughterhouse' | 'farmGroup' | 'individualFarm' | 'farmArea';

/** §1 applicant and §2c payment company share this shape. */
export interface Party {
  companyName: string;
  companyNameEnglish: string;
  address: string;
  city: string;
  country: string;
  contactName: string;
  contactTitle: string;
  phone: string;
  email: string;
}

/** §3 — one per standard. */
export interface StandardBlock {
  selected: boolean;
  certificationStatus: CertStatus | '';
  /** keyed by the prior-certification checkbox key declared in schema.js */
  priorCertifications: Record<string, boolean>;
  previousLicenceNo: string;
  previousCertifier: string;
  certificationRenewalDate: string;
}

export interface RafStandardBlock extends StandardBlock {
  subStandards: RafSubStandard[];
}

/** §4 — the 12 fixed categories. */
export interface ProductCategory {
  selected: boolean;
  detail: string;
}

/** §4 — the その他 rows (master holds 8). */
export interface ProductOther {
  selected: boolean;
  name: string;
  detail: string;
}

/** §5 — master holds 6 rows; this array is unbounded. */
export interface Facility {
  name: string;
  address: string;
  employeeCount: string;
  /** written to the official 規格 cell as a joined string */
  standards: StandardKey[];
  /** written to the official 活動/工程のリスト cell as a joined string */
  activities: string[];
  activitiesOther: string;
  unitType: UnitType | '';
  previouslyCertified: YesNo | '';
}

/** §9 — master holds 3 rows. */
export interface RdsSlaughterhouse {
  name: string;
  address: string;
  contact: string;
  waterfowlSpecies: string;
  annualSlaughterCount: string;
  activities: string;
  previouslyCertified: YesNo | '';
}

/** §10 — master holds 3 rows. */
export interface RdsFarmGroup {
  groupName: string;
  contact: string;
  memberCount: string;
  parentFarmCount: string;
  waterfowlSpecies: string;
  annualRearedCount: string;
  annualSlaughterCount: string;
  activities: string;
  previouslyCertified: YesNo | '';
}

/** §11 — master holds 3 rows. */
export interface RdsIndividualFarm {
  name: string;
  address: string;
  contact: string;
  waterfowlSpecies: string;
  annualRearedCount: string;
  activities: string;
  isParentFarm: YesNo | '';
  previouslyCertified: YesNo | '';
}

/** §12 — master holds 3 rows. */
export interface RdsFarmArea {
  areaName: string;
  contact: string;
  collectorCount: string;
  regionName: string;
  waterfowlSpecies: string;
  activities: string;
  estimatedAnnualVolume: string;
  previouslyCertified: YesNo | '';
}

export interface ApplicationData {
  meta: {
    schemaVersion: string;
    /** which official template this draft was started against */
    templateVersion: string;
    draftId: string;
    savedAt: string;
    locale: 'ja';
  };

  applicant: Party;

  payment: {
    currency: Currency | '';
    currencyOther: string;
    taxId: string;
    rush: { siteVisit: boolean; certificationDecision: boolean };
    /** when true, `company` is mirrored from `applicant` at write time */
    sameAsApplicant: boolean;
    company: Party;
  };

  standards: {
    ocs: StandardBlock;
    gots: StandardBlock;
    ivnBest: StandardBlock;
    grs: StandardBlock;
    rcs: StandardBlock;
    raf: RafStandardBlock;
    rds: StandardBlock;
  };

  products: {
    categories: Record<string, ProductCategory>;
    others: ProductOther[];
  };

  facilitiesMeta: { hasSubcontractors: YesNo | '' };
  facilities: Facility[];

  otherCertifications: Record<string, YesNo | ''>;

  chemicalCompliance: {
    /** §6 r14 — GOTS-scoped */
    usesChemicalsGots: YesNo | '';
    chemicalCountGots: string;
    /** §6 r16 — GRS-scoped */
    usesChemicalsGrs: YesNo | '';
    chemicalCountGrs: string;
  };

  certifications: {
    refusedBefore: YesNo | '';
    refusedDetail: string;
    /** §6 r21 has no yes/no control in the master — free text only */
    prohibitedDetail: string;
  };

  recycling: {
    materialType: RecycledMaterialType | '';
    vr2Sites: string;
    inputWasteDescription: string;
    collectorCount: string;
    collectorLocations: string;
    collectorActivities: string;
  };

  rds: {
    scopes: RdsScope[];
    slaughterhouses: RdsSlaughterhouse[];
    farmGroups: RdsFarmGroup[];
    individualFarms: RdsIndividualFarm[];
    farmAreas: RdsFarmArea[];
  };

  declaration: {
    companyName: string;
    signatoryNameTitle: string;
    date: string;
    representative: { companyName: string; contactName: string; email: string };
    /** signature and company seal are physical — never populated by this system */
  };
}
