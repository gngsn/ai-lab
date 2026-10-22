/** What a slidechange event and a host's onChange callback carry. */
export type StepState = { fragments: number[]; stepper: number };
export type SlideChangeDetail = StepState & {
  index: number;
  section_id: string | null;
  total: number;
};

/** The small interface present, view and share drive, in either host mode. */
export type DeckHost = {
  mode: "deck" | "speakeasy";
  slides: HTMLElement[];
  index(): number;
  goTo(i: number): void;
  getStepState(): StepState;
  applyStepState(state?: Partial<StepState>): void;
  onChange(cb: (detail: SlideChangeDetail) => void): void;
};
