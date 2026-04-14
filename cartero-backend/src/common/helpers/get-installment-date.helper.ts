export function getInstallmentDate(
  baseDate: Date,
  installmentIndex: number,
): Date {
  const installmentDate = new Date(baseDate);
  const originalDay = installmentDate.getUTCDate();

  installmentDate.setUTCDate(1);
  installmentDate.setUTCMonth(installmentDate.getUTCMonth() + installmentIndex);

  const lastDayOfMonth = new Date(
    Date.UTC(
      installmentDate.getUTCFullYear(),
      installmentDate.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();

  installmentDate.setUTCDate(Math.min(originalDay, lastDayOfMonth));

  return installmentDate;
}
