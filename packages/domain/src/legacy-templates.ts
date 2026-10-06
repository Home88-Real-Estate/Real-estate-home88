/**
 * Estate+ legacy wording, kept as SOURCE MATERIAL ONLY.
 *
 * These texts came from the old system and are preserved exactly as supplied
 * (including their typos, the mixed simple/exclusive paragraphs, and the
 * English exclusive text that stops mid-sentence). They are not HOME88's
 * approved legal wording and are never activated automatically:
 *
 *  - every record created from them has source ESTATE_PLUS_LEGACY and
 *    requiresLegalReview = true;
 *  - the database refuses to make such a template version ACTIVE until counsel's
 *    approval (who, when, and for which exact text) is recorded;
 *  - historical documents are never rewritten.
 *
 * `detectLegacyLegalFlags` lists what a lawyer must look at in a text.
 */

export const LEGACY_SOURCE = "ESTATE_PLUS_LEGACY";

export type LegacyTemplate = {
  /** SHOWING for the Υπόδειξη, otherwise the assignment type the old text was used for. */
  type: "SHOWING" | "SIMPLE_ASSIGNMENT" | "EXCLUSIVE_ASSIGNMENT";
  locale: "el" | "en";
  title: string;
  body: string;
};

export const LEGACY_LEGAL_FLAGS = [
  { code: "LAW_2472_1997", label: "Παραπομπή στον Ν. 2472/1997 (καταργήθηκε· ισχύουν ο ΓΚΠΔ και ο Ν. 4624/2019)" },
  { code: "RETENTION_10_YEARS", label: "Σταθερή υπόσχεση τήρησης δεδομένων για 10 έτη" },
  { code: "COURT_JURISDICTION", label: "Ρήτρα αρμοδιότητας δικαστηρίων Αθηνών" },
  { code: "CIVIL_CODE_707_WAIVER", label: "Παραίτηση από την ένσταση του άρθρου 707 ΑΚ (υπέρμετρη αμοιβή)" },
  { code: "LAW_4072_2012", label: "Παραπομπή στον Ν. 4072/2012 (ελέγξτε ισχύ και παραπομπές)" },
  { code: "PD_248_1993", label: "Παραπομπή στο Π.Δ. 248/1993" },
  { code: "DUAL_REPRESENTATION", label: "Δικαίωμα του μεσίτη να ενεργεί και για τον αντισυμβαλλόμενο" },
  { code: "MIXED_SIMPLE_EXCLUSIVE", label: "Το ίδιο κείμενο περιέχει όρους απλής και αποκλειστικής ανάθεσης" },
  { code: "DURATION_ALTERNATIVE", label: "Εναλλακτική διατύπωση «αορίστου/ορισμένου χρόνου» χωρίς επιλογή" },
  { code: "FEE_AMOUNT_UNRESOLVED", label: "Ποσό ή ποσοστό αμοιβής και ΦΠΑ μένουν κενά" },
  { code: "UNFILLED_PLACEHOLDERS", label: "Κενά πεδία (…… / ......) στο κείμενο" },
  { code: "TEXT_TRUNCATED", label: "Το κείμενο φαίνεται κομμένο (τελειώνει χωρίς τελεία)" },
] as const;

export type LegacyLegalFlag = (typeof LEGACY_LEGAL_FLAGS)[number]["code"];

/** Looks only; never edits. Order follows LEGACY_LEGAL_FLAGS. */
export function detectLegacyLegalFlags(text: string): LegacyLegalFlag[] {
  const found = new Set<LegacyLegalFlag>();
  const has = (re: RegExp) => re.test(text);
  if (has(/2472\s*\/\s*1997/)) found.add("LAW_2472_1997");
  if (has(/διάστημα\s+10\s+ετών|period\s+of\s+10\s+years/i)) found.add("RETENTION_10_YEARS");
  if (has(/αρμόδια\s+είναι\s+τα\s+δικαστήρια|courts\s+of\s+Athens/i)) found.add("COURT_JURISDICTION");
  if (has(/707\s+του\s+ΑΣΤΙΚΟΥ|objection\s+707|Article\s+707/i)) found.add("CIVIL_CODE_707_WAIVER");
  if (has(/4072\s*\/\s*(?:11-4-)?2012|Law\s+4072/)) found.add("LAW_4072_2012");
  if (has(/Π\.Δ\.\s*248\s*\/\s*93|P\.D\.\s*248\s*\/\s*93/)) found.add("PD_248_1993");
  if (has(/ενεργήσει\s+έναντι\s+αμοιβής\s+και\s+για\s+τον\s+αντισυμβαλλόμενο|act\s+for\s+a\s+fee\s+for\s+my\s+counterparty/i)) found.add("DUAL_REPRESENTATION");
  if (has(/(?:απλή\s+ανάθεση|simple\s+assignment)/i) && has(/(?:αποκλειστική\s+ανάθεση|exclusive\s+assignment)/i)) found.add("MIXED_SIMPLE_EXCLUSIVE");
  if (has(/αορίστου\s*\/\s*ορισμένου|indefinite\s*\/\s*(?:indefinite|definite)/i)) found.add("DURATION_ALTERNATIVE");
  if (has(/(?:ΕΥΡΩ|EURO)\s*[….]{3,}|ποσοστό\s*[….]{3,}|percentage\s*\.{3,}/i)) found.add("FEE_AMOUNT_UNRESOLVED");
  if (has(/…{2,}|\.{5,}/)) found.add("UNFILLED_PLACEHOLDERS");
  const trimmed = text.trimEnd();
  if (trimmed.length > 0 && !/[.;:!?"»)]$/.test(trimmed)) found.add("TEXT_TRUNCATED");
  return LEGACY_LEGAL_FLAGS.map((f) => f.code).filter((c) => found.has(c));
}

export const LEGACY_ESTATE_PLUS_TEMPLATES: LegacyTemplate[] = [
  { type: "SHOWING", locale: "el", title: "Κείμενο εντολής υπόδειξης", body: `Δηλώνω δε και ομολογώ ότι, σε περίπτωση που πραγματοποιηθεί μίσθωση ή αγορά των ανωτέρω ακινήτων είτε από εμένα, είτε από πρόσωπο στο οποίο εγώ περαιτέρω θα υποδείξω τα ακίνητα, για λογαριασμό των οποίων δηλώνω υπεύθυνα ότι υπογράφω την παρούσα , υποχρεούμαι τόσον εγώ όσον και αυτοί, αλληλεγγύως και εις ολόκληρο έκαστος και ασχέτως αν τα ανωτέρω ακίνητα υποδειχθούν εκ των υστέρων και από άλλον διαμεσολαβητή, να καταβάλω την συμφωνηθείσα αμοιβή σας σύμφωνα με τις διατάξεις του Π.Δ. 248/93 όπως αναγράφεται στον πίνακα άνωθεν, αμοιβή την οποία εκ των προτέρων θεωρώ εύλογη, δίκαιη και μη υπερβολική και υποχρεούμαι να την καταβάλω την ημέρα υπογραφής του Μισθωτηρίου ή Προσυμφώνου ή του Οριστικού Συμβολαίου. Περαιτέρω δε παραιτούμαι από την ένσταση 707 του ΑΣΤΙΚΟΥ ΚΩΔΙΚΑ της υπέρμετρης αμοιβής. Σε περίπτωση εργολαβικού ο εργολάβος ή ο οικοπεδούχος έχουν υποχρέωση να καταβάλουν στον Διαμεσολαβητή κατά την σύνταξη του εργολαβικού προσυμφώνου ολόκληρο το ποσό της συμφωνηθείσας μεσιτικής αμοιβής. Συμφωνώ όπως ο παραπάνω μεσίτης έχει δικαίωμα να ενεργήσει έναντι αμοιβής και για τον αντισυμβαλλόμενο μου. Τυχόν τροποποίηση της παρούσης είναι δυνατή μόνο εγγράφως. Δηλώνω τέλος ότι έχω λάβει γνώση ότι εντολοδόχος μου, τηρεί βάση του Ν.2472/1997 τα προσωπικά μου στοιχειά στο αρχείο του και ότι μπορώ και εγώ ο ίδιος να έχω πρόσβαση σε αυτά σύμφωνα με το νόμο. Επιπρόσθετος συμφωνώ πως για κάθε περίπτωση που δεν αναφέρετε στην παρούσα σύμβαση ισχύει ο νομός περί μεσιτών του ΦΕΚ 86 Α Νόμος 4072/ 11-4-2012. Συνομολογώ ότι για τη δικαστική επίλυση οποιασδήποτε διαφοράς προκύψει κατά την εκτέλεση της παρούσας, αρμόδια είναι τα δικαστήρια Αθηνών.

Το παρόν διαβάστηκε και έγινε απόλυτα κατανοητό κατόπιν υπογράφηκε και έλαβα αντίγραφο.` },
  { type: "SIMPLE_ASSIGNMENT", locale: "el", title: "Κείμενο απλής εντολής ανάθεσης", body: `                                                                                        Σας υπόσχομαι, αναγνωρίζω και δηλώνω

 Ότι για την περίπτωση που καταρτιστεί τελικά κύρια σύμβαση για το παραπάνω ακίνητο, είτε με πελάτη σας, μέλος της οικογενείας του, οικείους, συνεργάτες και συνεταίρους του(ς) ή και με εταιρεία από την οποία έλκει συμφέροντα ένας εξ αυτών, ή και σε κάθε άλλη περίπτωση που καταρτιστεί τελικά κύρια σύμβαση ως αποτέλεσμα της υποδείξεως σας, ότι υποχρεούμαι στην καταβολή της ειδικώς συμφωνηθείσας ΜΕΣΙΤΙΚΗΣ ΑΜΟΙΒΗΣ ΣΑΣ που ανέρχεται:

στο κατ’ αποκοπή ποσό των ΕΥΡΩ ………………………………………………… ή σε ποσοστό …….% επί της συνολικής πραγματικής αγοραίας αξίας της κύριας συμβάσεως πλέον Φ.Π.Α. Την αμοιβή αυτή θεωρώ δίκαιη και εύλογη και υποχρεούμαι να σας την καταβάλω ως εξής:

-50% επί της συμφωνηθείσας αμοιβής με βάση τα ανωτέρω κατά την ημέρα της υπογραφής του τυχόν προσυμφώνου και

-το υπολειπόμενο 50% της συμφωνηθείσας αμοιβής με βάση τα ανωτέρω ήτοι μέχρι την πλήρη και ολοσχερή εξόφληση της και χωρίς άλλη όχλησή σας- από την οποία ρητώς παραιτούμαστε ακόμη κι αν η σύμβαση καταρτισθεί υπό αναβλητική αίρεση- κατά την ημέρα της υπογραφής του σχετικού οριστικού συμβολαίου ή του εργολαβικού συμβολαίου ή του μισθωτηρίου ή τυχόν άλλου συμφωνητικού.

Συμφωνώ η παρούσα εντολή να είναι αορίστου/ορισμένου χρόνου (μέχρι τις ...../.../20...) και συναινώ στην κατάρτιση σύμβασης μεσιτείας ανάμεσα σε Εσάς και τους υποψήφιους αγοραστές. Περαιτέρω δηλώνω, ότι το ακίνητο δεν έχει πραγματικά ελαττώματα ή έχει:……………....................... ……………………………………………………………………………………………………………………………………..

Στην περίπτωση κατάρτισης εντολής αορίστου χρόνου (απλή ανάθεση) δεσμεύομαι σύμφωνα με τις διατάξεις του Ν. 4072/2012 ότι σε περίπτωση πώλησης / μίσθωσης του παραπάνω Ακινήτου μου, με την υπόδειξη ή μεσολάβηση σας σε οποιονδήποτε πελάτη της εταιρίας σας , να σας καταβάλω εις ολόκληρο την ειδικά συμφωνηθείσα αμοιβή , που προαναφέρεται πλέον Φ.Π.Α.

Στην περίπτωση κατάρτισης εντολής ορισμένου χρόνου (αποκλειστική ανάθεση) σύμφωνα με τα οριζόμενα ανωτέρω και τις διατάξεις του Ν. 4072/2012 και σε περίπτωση επίτευξης συμφωνίας πωλήσεως/μισθώσεως του ως άνω Ακινήτου µου κατά τη διάρκεια του παραπάνω χρόνου ισχύος της εντολής µου, ανεξάρτητα αν η πώληση/μίσθωση αυτή οφείλεται στην υπόδειξη ή µεσολάβηση του εδώ αποκλειστικού µεσίτη ή στις ενέργειες άλλου µεσίτη ή άλλου προσώπου, κατά παράβαση των υποχρεώσεων µου στις τελευταίες αυτές περιπτώσεις, υπόσχομαι και υποχρεούμαι σε κάθε περίπτωση να καταβάλω στον άνω µεσίτη και µάλιστα κατά τη δήλη ηµέρα της υπογραφής του σχετικού οριστικού πωλητηρίου συμβολαίου χωρίς άλλη όχληση την ειδικά συμφωνηθείσα µεσιτική αμοιβή, που προαναφέρεται πλέον Φ.Π.Α."

Επιπλέον, δεσμεύομαι να σας ειδοποιήσω τουλάχιστον μια πλήρη εργάσιμη ημέρα πριν την κατάρτιση της σύμβασης πώλησης προκειμένου να προσέλθετε στο συμβολαιογράφο και να δηλωθεί η μεσιτεία σας και υποχρεούμαι να σας αποζημιώσω για την τυχόν παράλειψή μου.

Περαιτέρω συναινώ ρητά στη συλλογή, επεξεργασία, κοινοποίηση/γνωστοποίηση σε άλλους μεσίτες με τους οποίους θα συνεργαστείτε στo πλαίσιo της παρούσας εντολής, στην αποθήκευση για χρονικό διάστημα 10 ετών και στη συνέχεια στη διαγραφή των ως άνω στοιχείων του ακινήτου, καθώς και των προσωπικών μου στοιχείων, ήτοι: ονοματεπώνυμο, τηλέφωνο, διεύθυνση, e-mail, Α.Φ.Μ., ……………………………………………..

Η παραπάνω επεξεργασία των δεδομένων έχει αποκλειστικό σκοπό την ανεύρεση ενδιαφερόμενων αγοραστών, μισθωτών, εργολάβων και την υπογραφή της κύριας σύμβασης, δεν αφορά άλλο σκοπό επεξεργασίας κι ενδέχεται να καταστούν προσιτά και να τύχουν επεξεργασίας από υπαλλήλους συνεργάτες της εταιρείας/μεσίτες, πάντα στο πλαίσιο της παρούσας εντολής και για τον σκοπό αυτόν.

Με την παρούσα λαμβάνω γνώση του δικαιώματός μου για πρόσβαση, διόρθωση, διαγραφή των ΔΠΧ (Δεδομένων Προσωπικού Χαρακτήρα) και φορητότητάς τους προς άλλον υπεύθυνο ή εκτελούντα την επεξεργασία, αποστέλλοντας σχετική επιστολή στο e-mail .............................. ή στη διεύθυνση…………………………………………. και σε περίπτωση που ασκήσω ένα από τα παραπάνω δικαιώματα, ο μεσίτης /εταιρεία υποχρεούται να λάβει κάθε δυνατό μέτρο για την ικανοποίηση του αιτήματός μου ή να απαντήσει προσηκόντως και γραπτώς για την τυχόν αδυναμία ή καθυστέρηση ικανοποίησής του σύμφωνα με τον Κανονισμό (Ε.Ε.) 2016/679.

Παρέλαβα αντίγραφο της εντολής μου αυτής

ΣΥΝΑΙΝΩ ΣΤΗΝ ΕΠΕΞΕΡΓΑΣΙΑ ΤΩΝ ΠΡΟΣΩΠΙΚΩΝ ΜΟΥ ΔΕΔΟΜΕΝΩΝ ΚΑΤΑ ΤΑ ΑΝΩΤΕΡΩ` },
  { type: "EXCLUSIVE_ASSIGNMENT", locale: "el", title: "Κείμενο αποκλειστικής εντολής ανάθεσης", body: `                                                                                        Σας υπόσχομαι, αναγνωρίζω και δηλώνω

 Ότι για την περίπτωση που καταρτιστεί τελικά κύρια σύμβαση για το παραπάνω ακίνητο, είτε με πελάτη σας, μέλος της οικογενείας του, οικείους, συνεργάτες και συνεταίρους του(ς) ή και με εταιρεία από την οποία έλκει συμφέροντα ένας εξ αυτών, ή και σε κάθε άλλη περίπτωση που καταρτιστεί τελικά κύρια σύμβαση ως αποτέλεσμα της υποδείξεως σας, ότι υποχρεούμαι στην καταβολή της ειδικώς συμφωνηθείσας ΜΕΣΙΤΙΚΗΣ ΑΜΟΙΒΗΣ ΣΑΣ που ανέρχεται:

στο κατ’ αποκοπή ποσό των ΕΥΡΩ ………………………………………………… ή σε ποσοστό …….% επί της συνολικής πραγματικής αγοραίας αξίας της κύριας συμβάσεως πλέον Φ.Π.Α. Την αμοιβή αυτή θεωρώ δίκαιη και εύλογη και υποχρεούμαι να σας την καταβάλω ως εξής:

-50% επί της συμφωνηθείσας αμοιβής με βάση τα ανωτέρω κατά την ημέρα της υπογραφής του τυχόν προσυμφώνου και

-το υπολειπόμενο 50% της συμφωνηθείσας αμοιβής με βάση τα ανωτέρω ήτοι μέχρι την πλήρη και ολοσχερή εξόφληση της και χωρίς άλλη όχλησή σας- από την οποία ρητώς παραιτούμαστε ακόμη κι αν η σύμβαση καταρτισθεί υπό αναβλητική αίρεση- κατά την ημέρα της υπογραφής του σχετικού οριστικού συμβολαίου ή του εργολαβικού συμβολαίου ή του μισθωτηρίου ή τυχόν άλλου συμφωνητικού.

Συμφωνώ η παρούσα εντολή να είναι αορίστου/ορισμένου χρόνου (μέχρι τις ...../.../20...) και συναινώ στην κατάρτιση σύμβασης μεσιτείας ανάμεσα σε Εσάς και τους υποψήφιους αγοραστές. Περαιτέρω δηλώνω, ότι το ακίνητο δεν έχει πραγματικά ελαττώματα ή έχει:……………....................... ……………………………………………………………………………………………………………………………………..

Στην περίπτωση κατάρτισης εντολής αορίστου χρόνου (απλή ανάθεση) δεσμεύομαι σύμφωνα με τις διατάξεις του Ν. 4072/2012 ότι σε περίπτωση πώλησης / μίσθωσης του παραπάνω Ακινήτου μου, με την υπόδειξη ή μεσολάβηση σας σε οποιονδήποτε πελάτη της εταιρίας σας , να σας καταβάλω εις ολόκληρο την ειδικά συμφωνηθείσα αμοιβή , που προαναφέρεται πλέον Φ.Π.Α.

Στην περίπτωση κατάρτισης εντολής ορισμένου χρόνου (αποκλειστική ανάθεση) σύμφωνα με τα οριζόμενα ανωτέρω και τις διατάξεις του Ν. 4072/2012 και σε περίπτωση επίτευξης συμφωνίας πωλήσεως/μισθώσεως του ως άνω Ακινήτου µου κατά τη διάρκεια του παραπάνω χρόνου ισχύος της εντολής µου, ανεξάρτητα αν η πώληση/μίσθωση αυτή οφείλεται στην υπόδειξη ή µεσολάβηση του εδώ αποκλειστικού µεσίτη ή στις ενέργειες άλλου µεσίτη ή άλλου προσώπου, κατά παράβαση των υποχρεώσεων µου στις τελευταίες αυτές περιπτώσεις, υπόσχομαι και υποχρεούμαι σε κάθε περίπτωση να καταβάλω στον άνω µεσίτη και µάλιστα κατά τη δήλη ηµέρα της υπογραφής του σχετικού οριστικού πωλητηρίου συμβολαίου χωρίς άλλη όχληση την ειδικά συμφωνηθείσα µεσιτική αμοιβή, που προαναφέρεται πλέον Φ.Π.Α."

Επιπλέον, δεσμεύομαι να σας ειδοποιήσω τουλάχιστον μια πλήρη εργάσιμη ημέρα πριν την κατάρτιση της σύμβασης πώλησης προκειμένου να προσέλθετε στο συμβολαιογράφο και να δηλωθεί η μεσιτεία σας και υποχρεούμαι να σας αποζημιώσω για την τυχόν παράλειψή μου.

Περαιτέρω συναινώ ρητά στη συλλογή, επεξεργασία, κοινοποίηση/γνωστοποίηση σε άλλους μεσίτες με τους οποίους θα συνεργαστείτε στo πλαίσιo της παρούσας εντολής, στην αποθήκευση για χρονικό διάστημα 10 ετών και στη συνέχεια στη διαγραφή των ως άνω στοιχείων του ακινήτου, καθώς και των προσωπικών μου στοιχείων, ήτοι: ονοματεπώνυμο, τηλέφωνο, διεύθυνση, e-mail, Α.Φ.Μ., ……………………………………………..

Η παραπάνω επεξεργασία των δεδομένων έχει αποκλειστικό σκοπό την ανεύρεση ενδιαφερόμενων αγοραστών, μισθωτών, εργολάβων και την υπογραφή της κύριας σύμβασης, δεν αφορά άλλο σκοπό επεξεργασίας κι ενδέχεται να καταστούν προσιτά και να τύχουν επεξεργασίας από υπαλλήλους συνεργάτες της εταιρείας/μεσίτες, πάντα στο πλαίσιο της παρούσας εντολής και για τον σκοπό αυτόν.

Με την παρούσα λαμβάνω γνώση του δικαιώματός μου για πρόσβαση, διόρθωση, διαγραφή των ΔΠΧ (Δεδομένων Προσωπικού Χαρακτήρα) και φορητότητάς τους προς άλλον υπεύθυνο ή εκτελούντα την επεξεργασία, αποστέλλοντας σχετική επιστολή στο e-mail .............................. ή στη διεύθυνση…………………………………………. και σε περίπτωση που ασκήσω ένα από τα παραπάνω δικαιώματα, ο μεσίτης /εταιρεία υποχρεούται να λάβει κάθε δυνατό μέτρο για την ικανοποίηση του αιτήματός μου ή να απαντήσει προσηκόντως και γραπτώς για την τυχόν αδυναμία ή καθυστέρηση ικανοποίησής του σύμφωνα με τον Κανονισμό (Ε.Ε.) 2016/679.

Παρέλαβα αντίγραφο της εντολής μου αυτής

ΣΥΝΑΙΝΩ ΣΤΗΝ ΕΠΕΞΕΡΓΑΣΙΑ ΤΩΝ ΠΡΟΣΩΠΙΚΩΝ ΜΟΥ ΔΕΔΟΜΕΝΩΝ ΚΑΤΑ ΤΑ ΑΝΩΤΕΡΩ` },
  { type: "SHOWING", locale: "en", title: "Showing mandate text (English)", body: `I also declare and acknowledge that, in the event that the above properties are leased or purchased either by me, or by a person to whom I will further indicate the properties, on whose behalf I declare that I am signing this document, I am obliged as much as they are, jointly and severally and regardless of whether the above properties are subsequently indicated by another mediator, to pay your agreed fee in accordance with the provisions of the P.D. 248/93 as indicated in the table above, a fee which in advance I consider reasonable, fair and not excessive and I am obliged to pay it on the day of signing the Lease or Preliminary Agreement or the Final Contract. Furthermore, I do not waive objection 707 of the CIVIL CODE of excessive remuneration. In the case of a contract, the contractor or the tenant has an obligation to pay the Mediator the entire amount of the agreed brokerage fee when drawing up the preliminary contract.

I agree that the above broker has the right to act for a fee for my counterparty as well.

Any modification of the present is possible only in writing.

Finally, I declare that I have received knowledge that my agent, based on Law 2472/1997, keeps my personal details in his file and that I myself can have access to them in accordance with the law.

In addition, I agree that for any case that you do not mention in this contract, the law on brokers of the Official Gazette 86 A Law 4072/ 11-4-2012 applies.

I agree that for the judicial resolution of any dispute arising during the execution of this agreement, the courts of Athens are competent.

This was read and fully understood then signed and I received a copy.` },
  { type: "SIMPLE_ASSIGNMENT", locale: "en", title: "Simple assignment text (English)", body: `I promise, acknowledge and declare

That in the event that a main contract for the above property is finally drawn up, either with your client, a member of his family, his relatives, associates and partners or with a company from which one of them has an interest, or in any other case where a main contract is finally drawn up as a result of your suggestion, that I am obliged to pay you the specifically agreed BROKER'S COMPENSATION which amounts to:

a lump sum of EURO ......................................................... or a percentage .......% of the total actual market value of the main contract plus VAT. I consider this fee to be fair and reasonable and I am obliged to pay it to you as follows:

-50% of the agreed fee on the basis of the above at the date of signature of any preliminary contract, and

-the remaining 50% of the agreed fee on the basis of the above, i.e. until full and complete payment of the agreed fee and without further notice to you - which we expressly waive even if the contract is drawn up subject to suspension - on the date of signature of the relevant final contract or contractor's contract or lease or any other agreement.

I agree that this mandate is for an indefinite/indefinite term (until ...../.../20...) and I consent to the execution of a brokerage contract between You and the prospective purchasers. I further declare that the property has no real defects or has:...................................... .............................................................................................

In the case of a fixed-term mandate (exclusive assignment) in accordance with the above and the provisions of Law 4072/2012 and in the event of an agreement for the sale/lease of my property during the above period of validity of my mandate, regardless of whether this sale/lease is due to the suggestion or mediation of the exclusive broker or the actions of another broker or other person, in breach of my obligations in the latter cases, I promise and undertake in any case to pay to you in full the specially agreed fee, as stated above plus VAT.

In addition, I commit to give you at least one full business day's notice prior to the execution of the contract of sale to appear before the notary and declare your brokerage and I undertake to indemnify you for any failure to do so.

Furthermore, I expressly consent to the collection, processing, disclosure/disclosure to other brokers with whom you will cooperate within the framework of this mandate, to the storage for a period of 10 years and then to the deletion of the above property data, as well as my personal data, namely: full name, telephone number, address, e-mail, TAX REGISTRATION NUMBER, .....................................................

The above data processing has the exclusive purpose of finding interested buyers, tenants, contractors and signing the main contract, it does not concern any other processing purpose and may be made accessible and processed by employees of the company's associates/agents, always within the framework of this mandate and for this purpose.

I hereby acknowledge my right to access, rectify, delete and transfer my personal data to another controller or processor, by sending a letter to .............................. or to ................................................. and in case I exercise one of the above rights, the broker/company is obliged to take all possible measures to satisfy my request or to respond in due time and in writing to any inability or delay in satisfying it in accordance with Regulation (EU) 2016/679.

I have received a copy of this instruction

I CONSENT TO THE PROCESSING OF MY PERSONAL DATA MY DATA IN ACCORDANCE WITH THE ABOVE` },
  { type: "EXCLUSIVE_ASSIGNMENT", locale: "en", title: "Exclusive assignment text (English)", body: `I promise, acknowledge and declare

That in the event that a main contract for the above property is finally drawn up, either with your client, a member of his family, his relatives, associates and partners or with a company from which one of them has an interest, or in any other case where a main contract is finally drawn up as a result of your suggestion, that I am obliged to pay you the specifically agreed MISCELLANEOUS FEE which amounts to:

a lump sum of EURO ......................................................... or a percentage .......% of the total actual market value of the main contract plus VAT. I consider this fee to be fair and reasonable and I am obliged to pay it to you as follows:

-50% of the agreed fee on the basis of the above at the date of signature of any preliminary contract, and

-the remaining 50% of the agreed fee on the basis of the above, i.e. until full and complete payment of the agreed fee and without further notice to you - which we expressly waive even if the contract is drawn up subject to suspension - on the date of signature of the relevant final contract or contractor's contract or lease or any other agreement.

I agree that this mandate is for an indefinite/indefinite term (until ...../.../20...) and I consent to the execution of a brokerage contract between You and the prospective purchasers. I further declare that the property has no real defects or has:...................................... ........................................................................................................................................................

In the case of drawing up a mandate for an indefinite period (simple assignment) I undertake in accordance with the provisions of Law 4072/2012 that in case of sale / lease of my above Property, with your recommendation or mediation to any client of your company , to pay you in full the specifically agreed fee , as stated above plus VAT.

In the case of a fixed-term mandate (exclusive assignment) in accordance with the above and the provisions of Law 4072/2012 and in the event of an agreement for the sale/lease of my property during the above period of validity of my mandate, regardless of whether this sale/lease is due to the suggestion or mediation of the exclusive broker or the actions of another broker or other person, in breach of my obligations in the latter cases, I promise and undertake in any case to pay to

In addition, I commit to give you at least one full business day's notice prior to the execution of the contract of sale to appear before the notary and declare your brokerage and I undertake to indemnify you for any failure to do so.

Furthermore, I expressly consent to the collection, processing, disclosure/disclosure to other brokers with whom you will cooperate within the framework of this mandate, to the storage for a period of 10 years and then to the deletion of the above property data, as well as my personal data, namely: full name, telephone number, address, e-mail, TAX REGISTRATION NUMBER, .....................................................

The above data processing has the exclusive purpose of finding interested buyers, tenants, contractors and signing the main contract, it does not concern any other processing purpose and may be made accessible and processed by employees of the company's associates/agents, always within the framework of this mandate and for this purpose.

I hereby acknowledge my right to access, rectify, delete and transfer my personal data to another controller or processor, by sending a letter to .............................. or to ................................................. and in case I exercise one of the above rights, the broker/company is obliged to take all possible measures to satisfy my request or to respond in due time and in writing to any inability or delay in satisfying it in accordance with Regulation (EU) 2016/679.

I have received a copy of this instruction

I CONSENT TO THE PROCESSING OF MY PERSONAL DATA MY DATA IN ACCORDANCE WITH THE ABOVE` },
];
