export interface Currency {
  code: string; // ISO 4217
  name: string;
  symbol: string;
}

export const CURRENCIES: Currency[] = [
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "CAD", name: "Canadian Dollar", symbol: "CA$" },
  { code: "NGN", name: "Nigerian Naira", symbol: "₦" },
  { code: "GHS", name: "Ghanaian Cedi", symbol: "GH₵" },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh" },
  { code: "UGX", name: "Ugandan Shilling", symbol: "USh" },
  { code: "TZS", name: "Tanzanian Shilling", symbol: "TSh" },
  { code: "RWF", name: "Rwandan Franc", symbol: "RF" },
  { code: "ZAR", name: "South African Rand", symbol: "R" },
  { code: "ZMW", name: "Zambian Kwacha", symbol: "ZK" },
  { code: "INR", name: "Indian Rupee", symbol: "₹" },
  { code: "PKR", name: "Pakistani Rupee", symbol: "Rs" },
  { code: "BDT", name: "Bangladeshi Taka", symbol: "৳" },
  { code: "PHP", name: "Philippine Peso", symbol: "₱" },
  { code: "JMD", name: "Jamaican Dollar", symbol: "J$" },
  { code: "TTD", name: "Trinidad and Tobago Dollar", symbol: "TT$" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$" },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$" },
];
