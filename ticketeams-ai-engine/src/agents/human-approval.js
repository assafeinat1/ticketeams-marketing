require('dotenv').config();
const fs = require('fs');
const path = require('path');

const PENDING_DIR = path.join(__dirname, '..', 'pending-approvals');

// יצירת תיקייה אם לא קיימת
if (!fs.existsSync(PENDING_DIR)) {
  fs.mkdirSync(PENDING_DIR, { recursive: true });
}

/**
 * Sanitize matchKey to prevent path traversal attacks.
 * Only allows: a-z, A-Z, 0-9, hyphens, underscores, dots.
 */
function sanitizeMatchKey(matchKey) {
  if (!matchKey || typeof matchKey !== 'string') {
    throw new Error('matchKey חסר או לא תקין');
  }
  const sanitized = matchKey.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (sanitized.includes('..') || sanitized.startsWith('.')) {
    throw new Error('matchKey מכיל תווים לא בטוחים');
  }
  return sanitized;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Flatten image data from Creative Agent into a flat array.
 * Input formats:
 *   - { רגשית: { story: '/path', post: '/path', square: '/path' }, ... }
 *   - [{ format, style, filePath }]
 * Output: [{ format, style, filePath }]
 */
function flattenImagePaths(images) {
  if (!images) return [];

  // Already flat array
  if (Array.isArray(images)) return images;

  // Nested object: { style: { format: filePath } }
  const flat = [];
  for (const [style, formats] of Object.entries(images)) {
    if (typeof formats === 'object' && formats !== null) {
      for (const [format, filePath] of Object.entries(formats)) {
        if (typeof filePath === 'string' && filePath.length > 0) {
          flat.push({ style, format, filePath });
        }
      }
    }
  }
  return flat;
}

// ============================================================
// 1. saveForApproval — שומר מודעות לקובץ JSON לאישור
// ============================================================
function saveForApproval(matchKey, creativeOutput, pricingReport) {
  try {
    matchKey = sanitizeMatchKey(matchKey);
    const { adCopies, metaAds } = creativeOutput;

    const approval = {
      matchKey,
      createdAt: new Date().toISOString(),
      status: 'ממתין לאישור',
      versions: adCopies.map((copy, i) => ({
        index: i + 1,
        style: copy.style,
        headline: copy.headline,
        body: copy.body,
        cta: copy.cta,
        meta: metaAds[i],
      })),
      pricingReport,
    };

    // Store image paths if available (from Creative Agent)
    if (creativeOutput.images) {
      approval.images = flattenImagePaths(creativeOutput.images);
    }

    const filePath = path.join(PENDING_DIR, `${matchKey}.json`);
    fs.writeFileSync(filePath, JSON.stringify(approval, null, 2), 'utf-8');

    // Image discovery fallback: scan generated-ads if images array is empty
    if (!approval.images || approval.images.length === 0) {
      try {
        const generatedAdsDir = path.join(__dirname, '..', 'generated-ads');
        if (fs.existsSync(generatedAdsDir)) {
          const keyLower = matchKey.toLowerCase();
          const parts = keyLower.split('__').filter(Boolean);

          if (parts.length >= 2) {
            const team1 = parts[0].split('_')[0]; // first word of team1
            const team2 = parts[1].split('_')[0]; // first word of team2

            const folders = fs.readdirSync(generatedAdsDir, { withFileTypes: true })
              .filter(d => d.isDirectory());

            const matchFolder = folders.find(f => {
              const fLower = f.name.toLowerCase().replace(/-/g, '_');
              return fLower.includes(team1) && fLower.includes(team2);
            });

            if (matchFolder) {
              const folderPath = path.join(generatedAdsDir, matchFolder.name);
              const imageFiles = fs.readdirSync(folderPath).filter(f => f.endsWith('.jpg'));

              approval.images = imageFiles
                .map(f => {
                  const m = f.match(/^.+?_(רגשית|מידעית|דחיפות)_(post|story|square)\.jpg$/);
                  if (!m) return null;
                  return { style: m[1], format: m[2], filePath: path.join(folderPath, f) };
                })
                .filter(Boolean);

              if (approval.images.length > 0) {
                fs.writeFileSync(filePath, JSON.stringify(approval, null, 2), 'utf-8');
                console.log(`  → גילוי תמונות: נמצאו ${approval.images.length} תמונות ב-${matchFolder.name}`);
              }
            }
          }
        }
      } catch (imgErr) {
        console.warn('שגיאה בגילוי תמונות:', imgErr.message);
      }
    }

    console.log(`מודעה נשמרה לאישור: ${filePath}`);

    return { filePath, matchKey, status: 'ממתין לאישור' };
  } catch (error) {
    console.error('שגיאה בשמירת מודעה לאישור:', error.message);
    throw error;
  }
}

// ============================================================
// 2. loadPendingApproval — טוען מודעה ממתינה לפי matchKey
// ============================================================
function loadPendingApproval(matchKey) {
  try {
    matchKey = sanitizeMatchKey(matchKey);
    const filePath = path.join(PENDING_DIR, `${matchKey}.json`);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('שגיאה בטעינת מודעה ממתינה:', error.message);
    throw error;
  }
}

// ============================================================
// 3. listPendingApprovals — מחזיר את כל המודעות הממתינות
// ============================================================
function listPendingApprovals() {
  try {
    const files = fs.readdirSync(PENDING_DIR).filter((f) => f.endsWith('.json'));

    const pending = files.map((file) => {
      const raw = fs.readFileSync(path.join(PENDING_DIR, file), 'utf-8');
      const data = JSON.parse(raw);
      return {
        matchKey: data.matchKey,
        createdAt: data.createdAt,
        status: data.status,
        versionsCount: data.versions.length,
      };
    });

    return pending;
  } catch (error) {
    console.error('שגיאה בטעינת רשימת ממתינים:', error.message);
    throw error;
  }
}

// ============================================================
// 4. approveVersion — מאשר גרסה נבחרת ומעדכן סטטוס
// ============================================================
function approveVersion(matchKey, selectedVersion, selectedImageIndex) {
  try {
    matchKey = sanitizeMatchKey(matchKey);
    const filePath = path.join(PENDING_DIR, `${matchKey}.json`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`לא נמצא קובץ אישור עבור ${matchKey}`);
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const approval = JSON.parse(raw);

    if (selectedVersion < 1 || selectedVersion > approval.versions.length) {
      throw new Error(`גרסה ${selectedVersion} לא קיימת — יש ${approval.versions.length} גרסאות`);
    }

    const selected = approval.versions[selectedVersion - 1];

    approval.status = 'אושר';
    approval.approvedAt = new Date().toISOString();
    approval.selectedVersion = selectedVersion;
    approval.selectedAd = selected;

    // Store selected image index if provided and images exist
    if (selectedImageIndex != null && approval.images && approval.images.length > 0) {
      if (selectedImageIndex >= 0 && selectedImageIndex < approval.images.length) {
        approval.selectedImageIndex = selectedImageIndex;
      }
    } else if (approval.images && approval.images.length > 0) {
      // Default to first image if none specified
      approval.selectedImageIndex = 0;
    }

    fs.writeFileSync(filePath, JSON.stringify(approval, null, 2), 'utf-8');

    console.log(`גרסה ${selectedVersion} (${selected.style}) אושרה — ${matchKey}`);

    return {
      status: 'אושר',
      matchKey,
      selectedVersion,
      selectedAd: selected,
      selectedImageIndex: approval.selectedImageIndex ?? null,
      readyForPublish: true,
    };
  } catch (error) {
    console.error('שגיאה באישור גרסה:', error.message);
    throw error;
  }
}

// ============================================================
// בדיקה עצמית
// ============================================================
function selfTest() {
  console.log('=== Human Approval — בדיקה עצמית ===\n');

  // שמירה
  const mockCreative = {
    adCopies: [
      { style: 'רגשית', headline: 'החלום שלך מתחיל כאן', body: 'כרטיסים לארסנל בלונדון', cta: 'הזמינו עכשיו' },
      { style: 'מידעית', headline: 'Arsenal vs Everton', body: '14.3 | Emirates Stadium | London', cta: 'לפרטים' },
      { style: 'דחיפות', headline: 'נשארו כרטיסים אחרונים!', body: 'אל תפספסו — מלאי מוגבל', cta: 'אחרונים!' },
    ],
    metaAds: [
      { style: 'רגשית', facebook: { headline: 'החלום שלך', primary_text: 'כרטיסים', description: 'הזמינו' }, instagram: { caption: 'test' } },
      { style: 'מידעית', facebook: { headline: 'Arsenal vs Everton', primary_text: '14.3', description: 'לפרטים' }, instagram: { caption: 'test' } },
      { style: 'דחיפות', facebook: { headline: 'אחרונים!', primary_text: 'מוגבל', description: 'אחרונים' }, instagram: { caption: 'test' } },
    ],
    images: {
      'רגשית': { story: '/tmp/test/emotional_story.png', post: '/tmp/test/emotional_post.png', square: '/tmp/test/emotional_square.png' },
      'מידעית': { story: '/tmp/test/info_story.png', post: '/tmp/test/info_post.png', square: '/tmp/test/info_square.png' },
    },
  };

  const mockPricing = { currency: 'GBP', recommendations: [{ category: 'Cat 1', recommended: { price: 315, currency: 'GBP' } }] };

  const result = saveForApproval('arsenal__everton__premier-league__2026-03-14', mockCreative, mockPricing);
  console.log(`1. שמירה: ${result.status}`);

  // טעינה
  const loaded = loadPendingApproval('arsenal__everton__premier-league__2026-03-14');
  console.log(`2. טעינה: ${loaded.versions.length} גרסאות, סטטוס: ${loaded.status}`);
  console.log(`   תמונות: ${loaded.images?.length || 0} (${loaded.images ? 'PASS' : 'FAIL'})`);

  // רשימה
  const list = listPendingApprovals();
  console.log(`3. ממתינים: ${list.length} מודעות`);

  // אישור עם בחירת תמונה
  const approved = approveVersion('arsenal__everton__premier-league__2026-03-14', 2, 1);
  console.log(`4. אישור: גרסה ${approved.selectedVersion} (${approved.selectedAd.style}) — ${approved.status}`);
  console.log(`   תמונה נבחרת: index ${approved.selectedImageIndex}`);

  // ניקוי קובץ בדיקה
  const testFile = path.join(PENDING_DIR, 'arsenal__everton__premier-league__2026-03-14.json');
  if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
  console.log('5. ניקוי קובץ בדיקה — בוצע');

  console.log('\n=== Human Approval — מוכן ===');
}

module.exports = {
  saveForApproval,
  loadPendingApproval,
  listPendingApprovals,
  approveVersion,
  sanitizeMatchKey,
};

if (require.main === module) {
  selfTest();
}
