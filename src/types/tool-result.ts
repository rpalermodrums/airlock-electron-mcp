export type ToolMeta = {
  suggestions?: readonly string[];
  warnings?: readonly string[];
  diagnostics?: Record<string, unknown>;
};

export interface ToolResult<TData> {
  data: TData;
  meta?: ToolMeta;
}
