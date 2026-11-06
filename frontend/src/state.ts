// Tiny hand-off between screens: after saving, the form tells the monthly screen
// which month to show (the month of the saved date) when it regains focus.
let pendingMonth: string | null = null;

export function setPendingMonth(month: string) {
  pendingMonth = month;
}

export function takePendingMonth(): string | null {
  const m = pendingMonth;
  pendingMonth = null;
  return m;
}

// The Add screen preselects the account used last time.
let lastAccountId: number | null = null;

export const getLastAccountId = () => lastAccountId;

export function setLastAccountId(id: number) {
  lastAccountId = id;
}
