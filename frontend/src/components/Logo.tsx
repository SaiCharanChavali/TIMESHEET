// The ShimentoX logo, with the lettering recoloured navy so it shows on light backgrounds.
// `rail` fits the narrow sidebar.
export function Logo({ small, rail }: { small?: boolean; rail?: boolean }) {
  return (
    <img
      src="/shimentox-logo.png"
      alt="ShimentoX"
      width={960}
      height={169}
      className={rail ? 'h-auto w-full max-w-18' : `w-auto ${small ? 'h-5' : 'h-7'}`}
    />
  );
}
