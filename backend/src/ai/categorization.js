export const categories = ["product", "delivery", "billing", "service", "other"];

export const categoryRubric = [
  "product: wrong, defective, damaged, or poor-quality item.",
  "delivery: late, missing, or misrouted shipment, or tracking issue.",
  "billing: charges, payments, invoices, refunds, or account credits.",
  "service: staff behavior, lack of response, or support-process issue.",
  "other: insufficient information or an issue outside the listed categories.",
  "For mixed complaints, classify the problem the customer wants resolved now.",
].join("\n");
