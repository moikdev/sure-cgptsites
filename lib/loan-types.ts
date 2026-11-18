export interface LoanTerms {
  subtype: "mortgage" | "student" | "auto" | "home_equity" | "line_of_credit" | "business" | "other" | null;
  initialBalance: number | null;
  startDate: string | null;
  termMonths: number | null;
  annualRate: string | null;
  rateType: string | null;
  rateChanges: { date: string; rate: string }[];
  dayCount: "thirty_360" | "actual_365" | "actual_actual";
  downPayment: number | null;
  insuranceRate: string | null;
  insuranceType: "level_term" | "decreasing_life" | null;
  principalOnlyTransfers: boolean;
}

export interface LoanPayment {
  number: number; date: string; openingBalance: number; payment: number;
  principal: number; interest: number; endingBalance: number; insurance: number;
  total: number; accrualRate: string; sizingRate: string;
}
