/**
 * Declarative form schema — the single source of truth for the wizard UI.
 *
 * Every field carries a `controls` reference back to the official Word content-control
 * index (`#N` in docs/_generated/control-inventory.tsv). Phase 2 does not use these to
 * write anything; they exist so no UI field can drift away from the official template,
 * and so Phase 4's mapping.json can be generated from this file rather than hand-written.
 *
 * Official Japanese wording is reproduced verbatim from the master. Do not reword it.
 * Explanatory text written for the web is marked `webHelp` and is clearly additional.
 */

export const TEMPLATE_VERSION = 'GOTS-TE/V7.0-DCN25-013';
export const SCHEMA_VERSION = '1.0.0';

/* ------------------------------------------------------------------ *
 * §3 Standards
 * ------------------------------------------------------------------ */

export const STANDARDS = [
  {
    key: 'ocs',
    name: 'Organic Content Standard (OCS)',
    nameJa: 'オーガニックコンテントスタンダード(OCS)',
    note: 'OCS 製品には、少なくとも 5% の認証コンテンツが含まれている必要があります。OCS 100% には、少なくとも 95% の認証有機栽培コンテンツが含まれている必要があります。',
    conflictNote: 'IDFLはGOTSを他の認証機関で取得している組織（企業）に対してOCS認証を発行しない。ただし、GOTSが他の認証機関からIDFLに移行中の場合を除く。',
    prior: [
      { key: 'ocs', label: '以前/現在、別の認証機関 (CB) から OCS 認証を受けている', control: 39 },
      { key: 'gots', label: '以前/現在、別の認証機関 (CB) から GOTS 認証を受けている', control: 40 },
    ],
    controls: { selected: 38, licence: 41, certifier: 42, renewalDate: 43 },
  },
  {
    key: 'gots',
    name: 'Global Organic Textile Standard (GOTS)',
    nameJa: 'グローバルオーガニックテキスタイルスタンダード(GOTS)',
    note: 'GOTS 製品には、最低 70% のオーガニック素材が含まれている必要があります。GOTS では、従来の綿やバージン ポリエステルなど、オーガニック繊維と混合できる追加の繊維素材に制限があります。詳細については、GOTS 規格を参照してください。',
    conflictNote: '注：IDFL は、OCS スコープ認証が IDFL に移管されている場合を除き、他の認証機関から OCS スコープ認証を取得している会社に GOTS スコープ認証を発行することはできません。',
    prior: [
      { key: 'gots', label: '以前/現在、別の認証機関 (CB) から GOTS 認証を受けている', control: 45 },
      { key: 'ocs', label: '以前/現在、別の認証機関 (CB) から OCS認証を受けている', control: 46 },
    ],
    controls: { selected: 44, licence: 47, certifier: 48, renewalDate: 49 },
  },
  {
    key: 'ivnBest',
    name: 'Naturtextil IVN BEST',
    nameJa: 'ナチュラルテキスタイル IVN ベスト',
    note: 'IVN BEST 製品には、付属品を除き、100% オーガニック繊維が含まれている必要があります。認証されたオーガニック原料でなければなりません。',
    prior: [
      { key: 'ivn', label: '以前/現在、別の認証機関 (CB) から IVN認証を受けている', control: 51 },
      { key: 'gots', label: '以前/現在、別の認証機関 (CB) からGOTS認証を受けている', control: 52 },
    ],
    controls: { selected: 50, licence: 53, certifier: 54, renewalDate: 55 },
  },
  {
    key: 'grs',
    name: 'Global Recycled Standard (GRS)',
    nameJa: 'グローバルリサイクルドスタンダード(GRS)',
    note: 'GRS 製品には、少なくとも 20% の認定リサイクル コンテンツが含まれている必要があります。GRS ロゴは、少なくとも 50% の認定リサイクル コンテンツを含む製品にのみ使用できます。',
    conflictNote: 'IDFLはRCSを他の認証機関で取得している組織（企業）に対してGRS認証を発行しない。ただし、RCSが他の認証機関からIDFLに移行中の場合を除く。',
    prior: [
      { key: 'grs', label: '以前/現在、別の認証機関 (CB) から GRS 認証を受けている', control: 57 },
      { key: 'rcs', label: '以前/現在、別の認証機関 (CB) から RCS 認証を受けている', control: 58 },
    ],
    controls: { selected: 56, licence: 59, certifier: 60, renewalDate: 61 },
  },
  {
    key: 'rcs',
    name: 'Recycled Claim Standard (RCS)',
    nameJa: 'リサイクルドクレイムスタンダード(RCS)',
    note: 'RCS 製品には、少なくとも 5% の認定コンテンツが含まれている必要があります。RCS 100% には、少なくとも 95% の認定リサイクルコンテンツが含まれている必要があります。',
    conflictNote: 'IDFLはGRSを他の認証機関で取得している組織（企業）に対してRSC認証を発行しない。ただし、GRSが他の認証機関からIDFLに移行中の場合を除く。',
    prior: [
      { key: 'rcs', label: '以前/現在、別の認証機関 (CB) から RCS 認証を受けている', control: 63 },
      { key: 'grs', label: '以前/現在、別の認証機関 (CB) から GRS 認証を受けている', control: 64 },
    ],
    controls: { selected: 62, licence: 65, certifier: 66, renewalDate: 67 },
  },
  {
    key: 'raf',
    name: 'Responsible Animal Fiber (RAF)',
    nameJa: 'レスポンシブルアニマルファイバー',
    note: 'RAF製品は、最低5％の認証成分を含んでいなければなりません。ラベルは、認証された含有率が100％の製品にのみ使用できます。リサイクル動物繊維はRAF認証の対象外です。',
    subStandards: [
      { key: 'rws', label: 'Responsible Wool Standard (RWS) レスポンシブルウールスタンダード', control: 69 },
      { key: 'rms', label: 'Responsible Mohair Standard (RMS) レスポンシブルモヘアスタンダード', control: 70 },
      { key: 'ras', label: 'Responsible Alpaca Standard (RAS) レスポンシブルアルパカスタンダード', control: 71 },
    ],
    prior: [
      { key: 'raf', label: '以前/現在、別の認証機関 (CB) から RAF 認証を受けている', control: 72 },
    ],
    controls: { selected: 68, licence: 73, certifier: 74, renewalDate: 75 },
  },
  {
    key: 'rds',
    name: 'Responsible Down Standard (RDS)',
    nameJa: 'レスポンシブルダウンスタンダード(RDS)',
    prior: [
      { key: 'rds', label: '以前/現在、別の認証機関 (CB) から RDS 認証を受けている', control: 77 },
    ],
    controls: { selected: 76, licence: 78, certifier: 79, renewalDate: 80 },
  },
];

/** Mutual-exclusion warnings stated in the master. Warn, never block. */
export const STANDARD_CONFLICTS = [
  { standard: 'ocs', priorKey: 'gots', message: 'IDFL は、他の認証機関で GOTS を取得している企業には OCS 認証を発行できません（GOTS が IDFL へ移行中の場合を除く）。移行予定であればその旨を IDFL にご連絡ください。' },
  { standard: 'gots', priorKey: 'ocs', message: 'IDFL は、他の認証機関で OCS スコープ認証を取得している企業には GOTS スコープ認証を発行できません（IDFL へ移管されている場合を除く）。' },
  { standard: 'grs', priorKey: 'rcs', message: 'IDFL は、他の認証機関で RCS を取得している企業には GRS 認証を発行できません（RCS が IDFL へ移行中の場合を除く）。' },
  { standard: 'rcs', priorKey: 'grs', message: 'IDFL は、他の認証機関で GRS を取得している企業には RCS 認証を発行できません（GRS が IDFL へ移行中の場合を除く）。' },
];

/* ------------------------------------------------------------------ *
 * §2 Payment
 * ------------------------------------------------------------------ */

export const CURRENCIES = [
  { value: 'USD', control: 10 }, { value: 'RMB', control: 11 }, { value: 'EURO', control: 12 },
  { value: 'TWD', control: 13 }, { value: 'TRY', control: 14 }, { value: 'CHF', control: 15 },
  { value: 'INR', control: 16 }, { value: 'BDT', control: 17 }, { value: 'JPY', control: 18 },
  { value: 'PKR', control: 19 }, { value: 'KRW', control: 20 }, { value: 'IDR', control: 21 },
  { value: 'VND', control: 22 }, { value: 'OTHER', control: 23 },
];

/* ------------------------------------------------------------------ *
 * §4 Products
 * ------------------------------------------------------------------ */

export const PRODUCT_CATEGORIES = [
  { key: 'homeTextiles', label: 'ホームテキスタイル / 寝具', controls: { selected: 81, detail: 82 } },
  { key: 'apparel', label: 'アパレル', controls: { selected: 83, detail: 84 } },
  { key: 'accessories', label: 'アクセサリー', controls: { selected: 85, detail: 86 } },
  { key: 'footwear', label: '履物', controls: { selected: 87, detail: 88 } },
  { key: 'fabric', label: '生地', controls: { selected: 89, detail: 90 } },
  { key: 'yarn', label: '糸', controls: { selected: 91, detail: 92 } },
  { key: 'fibreFilament', label: '繊維/フィラメント', controls: { selected: 93, detail: 94 } },
  { key: 'filling', label: 'フィリング/詰め物', controls: { selected: 95, detail: 96 } },
  { key: 'packaging', label: 'パッケージ', controls: { selected: 97, detail: 98 } },
  { key: 'recycledMaterial', label: 'リサイクル材料', controls: { selected: 99, detail: 100 } },
  { key: 'rawDownFeather', label: '未加工のダウン/フェザー', controls: { selected: 101, detail: 102 } },
  { key: 'birdsWaterfowl', label: '鳥類 / 水鳥', controls: { selected: 103, detail: 104 } },
];

/** master has 8 「その他」 rows */
export const PRODUCT_OTHER_MAX = 8;

/* ------------------------------------------------------------------ *
 * §5 Facilities
 * ------------------------------------------------------------------ */

export const FACILITY_MASTER_ROWS = 6;

export const UNIT_TYPES = [
  { value: 'main', label: 'メイン' },
  { value: 'facility', label: '施設' },
  { value: 'associatedSubcontractor', label: '関連下請け業者' },
  { value: 'certifiedSubcontractor', label: '認証下請け業者' },
];

/** Verbatim from the master's §5 instructions (「例：…」). */
export const FACILITY_ACTIVITIES = [
  'リサイクル材料', '紡績', '染色', '加工', '織布', '編み物', '洗濯', '仕上げ',
  '製造', '印刷', '貿易（売買、加工なし）', '保管', '輸入', '輸出', '管理',
  '下請け', '集中', '回収',
];

export const FACILITY_INSTRUCTIONS =
  '本認証範囲において認証製品を取引／取扱／加工するすべての施設について、以下の情報を提供してください。' +
  'これには、申請者の情報が含まれ、同じ認証範囲に含まれる事業所、流通センター、及び／又は供給業者等の' +
  '他の施設の情報が含まれる場合があります。\n' +
  '注：RDSと畜場またはRDS農場の認証については、セクション9-12を参照にしてください。\n' +
  '1、従業員数:正社員、契約社員、下請け社員をすべて含めてください。\n' +
  '2、活動／プロセスのリスト： 例：リサイクル材料、紡績、染色、加工、織布、編み物、洗濯、仕上げ、製造、' +
  '印刷、貿易（売買、加工なし）、保管、輸入、輸出、管理、下請け、集中、回収など。';

/* ------------------------------------------------------------------ *
 * §6 Other certifications
 * ------------------------------------------------------------------ */

export const OTHER_CERTIFICATIONS = [
  { key: 'oekoTexStep', en: 'OEKO-TEX STEP Environmental Performance Requirements', ja: 'OEKO-TEX STEP 環境パフォーマンス要件', controls: [180, 181] },
  { key: 'scsRcv', en: 'SCS Recycled Content Verification', ja: 'SCSリサイクルコンテンツ検証', controls: [182, 183] },
  { key: 'bsci', en: 'BSCI Social Audit', ja: 'BSCI社会監査', controls: [184, 185] },
  { key: 'sa8000', en: 'SA 8000 Audit', ja: 'SA 8000 監査', controls: [186, 187] },
  { key: 'higgFem', en: 'Higg Facilities Environmental Module (FEM)', ja: 'Higg 施設環境モジュール (FEM)', controls: [188, 189] },
  { key: 'higgFslm', en: 'Higg Facilities Social Labor Module (FSLM)', ja: 'Higg 施設社会労働モジュール (FSLM)', controls: [190, 191] },
  { key: 'higgBrm', en: 'Higg Brand Retail Module (BRM)', ja: 'Higg ブランド リテール モジュール (BRM)', controls: [192, 193] },
  { key: 'wrap', en: 'Worldwide Responsible Accreditation Program (WRAP)', ja: '世界的な責任ある認定プログラム(WRAP)', controls: [194, 195] },
  { key: 'gscpSocial', en: 'Any standard approved against the GSCP social reference code audit?', ja: 'GSCP 社会参照コード監査に対して承認された標準はありますか?', controls: [196, 197] },
  { key: 'gscpEnvironmental', en: 'Any standard approved against the GSCP environmental reference requirement audit?', ja: 'GSCP 環境参照要件監査に対して承認された標準はありますか?', controls: [198, 199] },
];

/* ------------------------------------------------------------------ *
 * §8 Recycling
 * ------------------------------------------------------------------ */

export const RECYCLED_MATERIAL_TYPES = [
  { value: 'none', label: 'リサイクル材料なし' },
  { value: 'postConsumer', label: 'はい、使用後材料' },
  { value: 'preConsumer', label: 'はい、使用前材料' },
  { value: 'both', label: 'はい、使用済み材料、使用前材料の両方' },
];

/* ------------------------------------------------------------------ *
 * §§9–12 RDS
 * ------------------------------------------------------------------ */

export const RDS_MASTER_ROWS = 3;

export const RDS_SCOPES = [
  { value: 'slaughterhouse', label: '屠畜場（肉加工業者）', section: 9 },
  { value: 'farmGroup', label: '農場グループ', section: 10 },
  { value: 'individualFarm', label: '個別農場', section: 11 },
  { value: 'farmArea', label: '農場エリア', section: 12 },
];

const YN = { previouslyCertified: { label: '以前に認証を受けたことがありますか？', type: 'yesno' } };

export const RDS_TABLES = {
  slaughterhouses: {
    scope: 'slaughterhouse', section: 9, itemLabel: '屠畜場',
    instructions: '認証範囲に屠畜場がある場合のみ適用されます。',
    rowControls: [[231, 232, 234, 236, 238, 240, 241], [242, 244, 246, 248, 250, 252, 254], [255, 257, 259, 261, 263, 265, 267]],
    fields: [
      { key: 'name', label: '施設名', type: 'text', required: true },
      { key: 'address', label: '施設の住所', type: 'text', required: true },
      { key: 'contact', label: 'ご担当者', type: 'text', required: true },
      { key: 'waterfowlSpecies', label: '水鳥の種類', type: 'text', required: true },
      { key: 'annualSlaughterCount', label: '年間に屠殺される水鳥の数', type: 'text', required: true },
      { key: 'activities', label: '活動/工程のリスト', type: 'textarea', required: true },
      { key: 'previouslyCertified', ...YN.previouslyCertified, required: true },
    ],
  },
  farmGroups: {
    scope: 'farmGroup', section: 10, itemLabel: '農場グループ',
    instructions: '認証範囲内に農場グループがある場合のみ適用されます。',
    rowControls: [[268, 269, 270, 271, 272, 273, 274, 275, 276], [277, 278, 279, 280, 281, 282, 283, 284, 285], [286, 287, 288, 289, 290, 291, 292, 293, 294]],
    fields: [
      { key: 'groupName', label: '農場のグループ名', type: 'text', required: true },
      { key: 'contact', label: 'ご担当者', type: 'text', required: true },
      { key: 'memberCount', label: '農場グループのメンバー数', type: 'text', required: true },
      { key: 'parentFarmCount', label: 'グループ内の親農場の数（ある場合）', type: 'text' },
      { key: 'waterfowlSpecies', label: '水鳥の種類/種', type: 'text', required: true },
      { key: 'annualRearedCount', label: '年間に飼育される水鳥の数', type: 'text', required: true },
      { key: 'annualSlaughterCount', label: '毎年屠殺される水鳥の数（該当する場合）', type: 'text' },
      { key: 'activities', label: '活動/プロセスのリスト', type: 'textarea', required: true },
      { key: 'previouslyCertified', ...YN.previouslyCertified, required: true },
    ],
  },
  individualFarms: {
    scope: 'individualFarm', section: 11, itemLabel: '個別農場',
    instructions: '認証範囲内に個々の農場を持つ場合にのみ適用されます。',
    rowControls: [[295, 296, 297, 298, 299, 300, 301, 302], [303, 304, 305, 306, 307, 308, 309, 310], [311, 312, 313, 314, 315, 316, 317, 318]],
    fields: [
      { key: 'name', label: '農場名', type: 'text', required: true },
      { key: 'address', label: '農場の住所', type: 'text', required: true },
      { key: 'contact', label: 'ご担当者', type: 'text', required: true },
      { key: 'waterfowlSpecies', label: '水鳥の種類/種', type: 'text', required: true },
      { key: 'annualRearedCount', label: '年間に飼育される水鳥の数', type: 'text', required: true },
      { key: 'activities', label: '活動/プロセスのリスト', type: 'textarea', required: true },
      { key: 'isParentFarm', label: '親農場ですか？', type: 'yesno', required: true },
      { key: 'previouslyCertified', ...YN.previouslyCertified, required: true },
    ],
  },
  farmAreas: {
    scope: 'farmArea', section: 12, itemLabel: '農場エリア',
    instructions: '認証範囲内に農地がある場合にのみ適用されます。',
    rowControls: [[319, 320, 321, 322, 323, 324, 325, 326], [327, 328, 329, 330, 331, 332, 333, 334], [335, 336, 337, 338, 339, 340, 341, 342]],
    fields: [
      { key: 'areaName', label: '農場エリア名', type: 'text', required: true },
      { key: 'contact', label: 'ご担当者', type: 'text', required: true },
      { key: 'collectorCount', label: 'コレクターの数', type: 'text', required: true },
      { key: 'regionName', label: '地域名', type: 'text', required: true },
      { key: 'waterfowlSpecies', label: '水鳥の種類/種', type: 'text', required: true },
      { key: 'activities', label: '活動/プロセスのリスト', type: 'textarea', required: true },
      { key: 'estimatedAnnualVolume', label: '年間に収集される材料の量の推定', type: 'text', required: true },
      { key: 'previouslyCertified', ...YN.previouslyCertified, required: true },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Country suggestions — the official cell is free text, so this is a
 * datalist (suggestions only), NOT a closed select. No transformation.
 * ------------------------------------------------------------------ */
export const COUNTRY_SUGGESTIONS = [
  '日本', '中国', '台湾', '韓国', 'ベトナム', 'インドネシア', 'タイ', 'インド', 'バングラデシュ',
  'パキスタン', 'トルコ', 'イタリア', 'ドイツ', 'フランス', 'ポルトガル', 'スペイン', 'オランダ',
  'イギリス', 'アメリカ合衆国', 'カナダ', 'メキシコ', 'ブラジル', 'ペルー', 'オーストラリア',
  'ニュージーランド', '南アフリカ', 'エジプト', 'スイス', 'スウェーデン', 'デンマーク', 'ポーランド',
  'チェコ', 'ルーマニア', 'カンボジア', 'ミャンマー', 'スリランカ', 'マレーシア', 'フィリピン',
];

/* ------------------------------------------------------------------ *
 * Steps
 * ------------------------------------------------------------------ */

export const STEPS = [
  { id: 'applicant', no: 1, title: '申請者情報', titleEn: 'Applicant Information', section: '§1' },
  { id: 'payment', no: 2, title: '支払情報', titleEn: 'Payment Information', section: '§2' },
  { id: 'standards', no: 3, title: '認証規格', titleEn: 'Certification', section: '§3' },
  { id: 'products', no: 4, title: '製品', titleEn: 'Products', section: '§4' },
  { id: 'facilities', no: 5, title: '施設・工程', titleEn: 'Facilities & Processes', section: '§5' },
  { id: 'compliance', no: 6, title: '認証・コンプライアンス情報', titleEn: 'Certification & Compliance', section: '§6' },
  { id: 'standardSpecific', no: 7, title: '規格別追加情報', titleEn: 'Standard-specific Information', section: '§8–12' },
  // Declaration comes before Review on purpose: the applicant confirms and signs
  // off first, then lands on Review & Download as the final step, where the
  // official Word document is generated. Changing this array changes the rail
  // order; engine.visibleSteps() carries the same order for Back/Next.
  { id: 'declaration', no: 8, title: '確認・署名', titleEn: 'Declaration', section: '§7' },
  { id: 'review', no: 9, title: '入力内容確認・ダウンロード', titleEn: 'Review & Download', section: '—' },
];

/** §1 / §2c share this field list. */
export const PARTY_FIELDS = [
  { key: 'companyName', label: '会社名', type: 'text', required: true },
  { key: 'companyNameEnglish', label: '会社名（英語表記）', type: 'text', required: true },
  { key: 'address', label: '住所', type: 'text', required: true },
  { key: 'city', label: '市', type: 'text', required: true },
  { key: 'country', label: '国', type: 'country', required: true },
  { key: 'contactName', label: 'ご担当者名', type: 'text', required: true },
  { key: 'contactTitle', label: '役職', type: 'text', required: true },
  { key: 'phone', label: '電話番号', type: 'tel', required: true },
  { key: 'email', label: 'メールアドレス', type: 'email', required: true },
];

export const APPLICANT_CONTROLS = { companyName: 1, companyNameEnglish: 2, address: 3, city: 4, country: 5, contactName: 6, contactTitle: 7, phone: 8, email: 9 };
export const PAYMENT_PARTY_CONTROLS = { companyName: 29, companyNameEnglish: 30, address: 31, city: 32, country: 33, contactName: 34, contactTitle: 35, phone: 36, email: 37 };
