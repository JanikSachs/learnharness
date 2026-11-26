import { createContext } from "react";

/** The chat page's materials seam: tutor `material:` links ask it whether an
 *  id exists and open it. Null outside a chat page (previews, settings): the
 *  links then render as plain text. */
export interface MaterialsLinks {
	has: (id: string) => boolean;
	open: (id: string) => void;
}

export const MaterialsContext = createContext<MaterialsLinks | null>(null);
