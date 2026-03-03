declare module "turndown" {
  interface TurndownRule {
    filter: string | string[] | ((node: HTMLElement) => boolean);
    replacement: (content: string, node: HTMLElement) => string;
  }

  interface TurndownOptions {
    headingStyle?: "setext" | "atx";
    codeBlockStyle?: "indented" | "fenced";
    keep?: (node: HTMLElement) => boolean | string[];
  }

  export default class TurndownService {
    constructor(options?: TurndownOptions);
    keep(selector: string | string[]): this;
    addRule(name: string, rule: TurndownRule): this;
    turndown(html: string): string;
  }
}
