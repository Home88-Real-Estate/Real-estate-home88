/**
 * Password length from Settings → Ασφάλεια, on top of the schema's fixed
 * minimum of 12. A setting can only make the rule stricter.
 */

import { validationFailed } from "../lib/errors";
import { securityConfig } from "./index";

export async function assertPasswordPolicy(password: string, field: string): Promise<void> {
  const { passwordMinLength } = await securityConfig();
  if (password.length < passwordMinLength) {
    throw validationFailed("Ο κωδικός δεν πληροί την πολιτική ασφαλείας.", {
      [field]: [`Τουλάχιστον ${passwordMinLength} χαρακτήρες.`],
    });
  }
}
