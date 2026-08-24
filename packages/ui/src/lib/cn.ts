import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, letting a later Tailwind class win over an earlier conflicting one. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
