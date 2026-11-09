// The ShimentoX logo, with the lettering recoloured navy so it shows on light backgrounds.
export function Logo({ small }: { small?: boolean }) {
  return (
    <img
      src="/shimentox-logo.png"
      alt="ShimentoX"
      width={960}
      height={169}
      className={`w-auto ${small ? 'h-5' : 'h-7'}`}
    />
  );
}
