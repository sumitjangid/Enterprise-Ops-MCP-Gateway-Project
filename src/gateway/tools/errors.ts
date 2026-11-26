export class ToolRequestError extends Error {
  constructor(
    readonly publicError: string,
    message: string,
  ) {
    super(message);
    this.name = "ToolRequestError";
  }
}
