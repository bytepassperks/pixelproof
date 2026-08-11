const tools = new Map();
export function registerTool(tool) { tools.set(tool.id, Object.freeze(tool)); return tool; }
export function getTool(id) { return tools.get(id); }
export function listTools() { return [...tools.values()]; }
