import type * as React from "react";
import type { FormState } from "./form-state";

export type FormSectionProps = {
  form: FormState;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  touched: Partial<Record<keyof FormState, boolean>>;
  setTouched: React.Dispatch<React.SetStateAction<Partial<Record<keyof FormState, boolean>>>>;
  errors: Partial<Record<keyof FormState, string>>;
};
