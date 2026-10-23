// Every fixed rule and storage space of the Stories contract. Changing one
// needs a published code upgrade.

// ---------- storage spaces ----------
export const CONFIG_SPACE_ID: u32 = 0;
export const LOCK_SPACE_ID: u32 = 1;
export const STORIES_SPACE_ID: u32 = 2;
export const SEGMENTS_SPACE_ID: u32 = 3;
export const EDITORS_SPACE_ID: u32 = 4;
export const ALLOWED_SPACE_ID: u32 = 5;
export const INVITES_SPACE_ID: u32 = 6;
export const CONTRIBUTOR_TOTALS_SPACE_ID: u32 = 7;
export const SURVIVING_TOTALS_SPACE_ID: u32 = 8;
export const TRIAL_USED_SPACE_ID: u32 = 9;
export const OPEN_COUNT_SPACE_ID: u32 = 10;
export const OPENER_COUNT_SPACE_ID: u32 = 11;
export const OPENER_LIST_SPACE_ID: u32 = 12;
export const CATEGORY_COUNT_SPACE_ID: u32 = 13;
export const CATEGORY_LIST_SPACE_ID: u32 = 14;
export const CATEGORY_MEMBER_SPACE_ID: u32 = 15;
export const AUTHOR_COUNT_SPACE_ID: u32 = 16;
export const AUTHOR_LIST_SPACE_ID: u32 = 17;
export const CATEGORIES_SPACE_ID: u32 = 18;
export const REPORTS_SPACE_ID: u32 = 19;
export const TEXT_HASHES_SPACE_ID: u32 = 20;
export const TERMS_ACCEPTED_SPACE_ID: u32 = 21;
export const ACCOUNT_STATUS_SPACE_ID: u32 = 22;
export const READING_PLACE_SPACE_ID: u32 = 23;
export const READING_COUNT_SPACE_ID: u32 = 24;
export const READING_LIST_SPACE_ID: u32 = 25;
export const VERSIONS_SPACE_ID: u32 = 26;
export const REMOVED_SPACE_ID: u32 = 27;
export const PART_EDITORS_SPACE_ID: u32 = 28;
export const PART_CHANGERS_SPACE_ID: u32 = 29;
export const LIVE_PARTS_SPACE_ID: u32 = 30;
export const MAX_SUMMARY: i32 = 1500;
export const VERSION_ORIGINAL: u32 = 1;
export const VERSION_CHANGED: u32 = 2;
export const VERSION_REMOVED: u32 = 3;
export const VERSION_EDITED: u32 = 4;
export const VERSION_FINAL: u32 = 5;
export const MIN_CHANGE_UNITS: u64 = 10;
export const MAX_PAID_CHANGES: u32 = 60;
// The writer's own edits make new versions up to this version number. Past
// it, an edit replaces the writer's own newest version, unless someone else's
// change is newest; then it gets one new version, so the change it answers
// stays on record (AB-047). The writer's edits never use up the room paid
// changes need.
export const WRITER_VERSION_ROOM: u32 = 99;
// Kept versions per part, so a takedown can always wipe them in one call:
// the original, the writer's 98, 60 paid changes (a paid removal included),
// one writer edit after each of them, and one last version: the final edit,
// or a free removal (a part is removed at most once, and a removed part has
// no final edit). A takedown only deletes them; it never reads their text
// (AB-059).
export const MAX_VERSIONS: u32 = WRITER_VERSION_ROOM + 2 * MAX_PAID_CHANGES + 1;
// Versions per get_versions call: each can hold a whole part, and a node's
// read limit stops a read of many (AB-060).
export const MAX_VERSION_READ: u32 = 5;
// And at most this many bytes of version text per call (always at least one
// version). A node read 3 versions of 10,000 three-byte characters (90 KB)
// and failed at 105 KB; this leaves room for the part itself (AB-070).
export const MAX_VERSION_READ_BYTES: i32 = 64000;
// Who hid a part (segment.hidden_by, AB-053).
export const HIDDEN_BY_REPORTS: u32 = 1;
export const HIDDEN_BY_MODERATOR: u32 = 2;
export const HIDDEN_BY_ADMIN: u32 = 3;

export const ADDRESS_LENGTH: i32 = 25;
export const DAY_SECONDS: u64 = 86400;

// ---------- fixed rules (changing these needs a published upgrade) ----------
export const BOOK_MIN: u64 = 100000;
export const BOOK_MAX: u64 = 1000000;
export const SHORT_MIN: u64 = 10000;
export const SHORT_MAX: u64 = 99999;
// A story this close to its own maximum may be closed even below the
// kind minimum, so a 100,000 Book stuck at 99,998 is not stuck forever.
export const CLOSE_SLACK: u64 = 100;

export const MAX_TITLE: i32 = 100;
export const MAX_CATEGORY_NAME: i32 = 32;
export const MAX_CATEGORIES: u32 = 255;
export const MAX_EDITORS: u32 = 10;
// Changers recorded for a citation alone, beyond the paid changes: the
// opener, 10 editors and the finalizer. Editors can rotate, so without this
// the list would grow for mana alone (AB-063).
export const CITATION_CHANGER_ROOM: u32 = MAX_EDITORS + 2;
export const MAX_ACCOUNTS_PER_CALL: i32 = 20;
export const MAX_FREE_CHAPTERS: u32 = 5;
export const MAX_BATCH_ITEMS: i32 = 20;
export const MAX_BATCH_UNITS: u64 = 20000;
export const MAX_LIST: u32 = 50;
export const MAX_SEGMENT_READ: u32 = 10;
// get_segments stops at this many bytes of text too (always at least one
// part), like get_versions, so long multibyte parts fit a node's read limit
// (audit M-5).
export const MAX_SEGMENT_READ_BYTES: i32 = 64000;
export const MAX_NEWLINE_RUN: i32 = 3;
export const SIGNATURE_LENGTH: i32 = 65;
// The browser signs exactly:
//   sha256( "swarmtales/invite/v1" || stories (25) || story id (8, BE) || invite id (8, BE) || wallet (25) )
export const INVITE_DOMAIN = "swarmtales/invite/v1";
// New text shorter than the minimum is refused, unless it exactly fills
// the story. Starts at 20; the admin may set 1 to 200.
export const DEFAULT_MIN_CONTRIBUTION: u32 = 20;
export const MIN_CONTRIBUTION_MAX: u32 = 200;
// The most removed segments the final edit folds in during one call.
export const MAX_SKIP_PER_CALL: u32 = 50;
export const MAX_INVITE_USES: u32 = 1000;
export const MAX_INVITE_DAYS: u64 = 365;
export const MAX_PDF_URI: i32 = 200;
export const MIN_PDF_HASH: i32 = 32;
export const MAX_PDF_HASH: i32 = 64;
// Moderation
export const MAX_NOTE: i32 = 200;
export const MAX_TERMS_URI: i32 = 200;
export const TERMS_HASH_LENGTH: i32 = 32;
export const DEFAULT_REPORT_THRESHOLD: u32 = 3;
export const REPORT_THRESHOLD_MAX: u32 = 20;
export const DEFAULT_STRIKE_LIMIT: u32 = 5;
export const STRIKE_LIMIT_MAX: u32 = 20;

// ---------- adjustable limits: start value and hard bounds ----------
// At most 6,000 per submission: a part, its versions and a page of reads
// stay well inside a node's read limit (audit M-5, O1-12).
export const DEFAULT_CAP: u32 = 6000;
export const CAP_MIN: u32 = 100;
export const CAP_MAX: u32 = 6000;
export const DEFAULT_TRIAL: u32 = 1000;
export const TRIAL_MAX: u32 = 5000;
export const DEFAULT_OPEN_LIMIT: u32 = 10;
export const DEFAULT_FULL_PRICE_PROJECTS: u32 = 3;
export const DEFAULT_MAX_PRICE_MULTIPLIER: u32 = 4;
export const MAX_PRICE_MULTIPLIER: u32 = 1024;
export const OPEN_LIMIT_MIN: u32 = 1;
export const OPEN_LIMIT_MAX: u32 = 10;
export const DEFAULT_ARCHIVE_DAYS: u32 = 60;
export const ARCHIVE_DAYS_MIN: u32 = 30;
export const DEFAULT_INACTIVITY_DAYS: u32 = 30;
export const INACTIVITY_DAYS_MIN: u32 = 30;
export const DAYS_MAX: u32 = 365;

// ---------- other contracts ----------
// First 4 bytes of sha256(entry point name).
export const INK_BURN_ENTRY: u32 = 2241834181;       // 0x859facc5 "burn"
export const INK_MINT_ENTRY: u32 = 3698268091;       // 0xdc6f17bb "mint"
export const SHOP_OPEN_FEE_ENTRY: u32 = 547545118;   // 0x20a2e01e "pay_open_fee"
export const SHOP_MEMBERSHIP_ENTRY: u32 = 1996602347; // 0x7701bbeb "get_membership"
export const SHOP_PROMO_ENTRY: u32 = 672038647;      // 0x280e7ef7 "get_promo_claimed"

export const BURN_CONTRIBUTION: u32 = 1;
export const MINT_REFUND: u32 = 5;
export const SHOP_TIER_WRITER: u32 = 2;
