/** How the five places are laid out from tablet width up: a sidebar down the left, or a bar along the top. */
export type NavStyle = "side" | "top";

/** Anything but "top" is the sidebar, so an old or damaged saved value never breaks the layout. */
export const parseNavStyle = (value: string | null | undefined): NavStyle => (value === "top" ? "top" : "side");
