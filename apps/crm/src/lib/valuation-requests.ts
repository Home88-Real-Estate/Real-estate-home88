/** Labels for website valuation requests (shared by the list and detail pages). */

export const REQUEST_STAGE_LABELS: Record<string, string> = {
  NEW: "Νέο",
  REVIEWING: "Σε εξέταση",
  CONTACTED: "Έγινε επικοινωνία",
  INSPECTION_REQUIRED: "Χρειάζεται αυτοψία",
  COMPLETED: "Ολοκληρώθηκε",
  CONVERTED: "Έγινε ανάθεση",
  CLOSED: "Έκλεισε",
};

export const CONFIDENCE_LABEL: Record<string, string> = { HIGH: "Υψηλή", MEDIUM: "Μέτρια", LOW: "Χαμηλή" };

export const SCOPE_LABEL: Record<string, string> = { AREA: "Ίδια περιοχή", CITY: "Ίδια πόλη", REGION: "Ίδια περιφέρεια" };

export const DIMENSION_LABEL: Record<string, string> = {
  location: "Τοποθεσία",
  type: "Τύπος",
  size: "Εμβαδόν",
  condition: "Κατάσταση",
  year: "Έτος",
  floor: "Όροφος",
  rooms: "Υπνοδωμάτια",
  features: "Χαρακτηριστικά",
};
