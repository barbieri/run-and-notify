import { createHandlebars, renderTemplateFile } from '../templates.js';
import type { TemplateContext } from '../types.js';

export const renderOptional = async (
  filename: string | undefined,
  context: TemplateContext,
): Promise<string | undefined> => {
  if (filename === undefined) {
    return undefined;
  }

  const handlebars = await createHandlebars(context.config.templatesDir);
  return renderTemplateFile(handlebars, context.config.templatesDir, filename, context);
};
