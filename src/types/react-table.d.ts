import "@tanstack/react-table"

declare module "@tanstack/react-table" {
  /**
   * Per-column classes, so a column definition can carry its own responsive
   * visibility (`hidden md:table-cell`) and alignment instead of the table
   * hard-coding them.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    headerClassName?: string
    cellClassName?: string
  }
}
