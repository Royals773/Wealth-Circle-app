export interface Country {
  code: string; // ISO 3166-1 alpha-2
  name: string;
}

// A working set covering the regions WealthCircle's target communities are
// concentrated in. Extend as groups from more countries sign up.
export const COUNTRIES: Country[] = [
  { code: "GB", name: "United Kingdom" },
  { code: "IE", name: "Ireland" },
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "NG", name: "Nigeria" },
  { code: "GH", name: "Ghana" },
  { code: "KE", name: "Kenya" },
  { code: "UG", name: "Uganda" },
  { code: "TZ", name: "Tanzania" },
  { code: "RW", name: "Rwanda" },
  { code: "ZA", name: "South Africa" },
  { code: "ZM", name: "Zambia" },
  { code: "ZW", name: "Zimbabwe" },
  { code: "IN", name: "India" },
  { code: "PK", name: "Pakistan" },
  { code: "BD", name: "Bangladesh" },
  { code: "PH", name: "Philippines" },
  { code: "JM", name: "Jamaica" },
  { code: "TT", name: "Trinidad and Tobago" },
  { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },
];
