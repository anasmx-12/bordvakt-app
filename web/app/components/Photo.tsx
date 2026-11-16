import Image from 'next/image';

/**
 * Ett riktigt foto (public/photos) med Bordvakts färgbehandling: blå skuggor och
 * orange ljus, så att alla bilder ser ut att höra ihop. Text i children läggs
 * längst ned på bilden.
 */
export default function Photo({
  src,
  alt,
  className = '',
  position = 'center',
  priority = false,
  children,
}: {
  src: string;
  alt: string;
  className?: string;
  /** Vilken del av bilden som ska synas när den beskärs, t.ex. "center 30%" */
  position?: string;
  priority?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={`photo-graded ${className}`}>
      <Image
        src={src}
        alt={alt}
        fill
        priority={priority}
        sizes="(max-width: 1024px) 100vw, 1100px"
        className="object-cover"
        style={{ objectPosition: position }}
      />
      {children && <div className="photo-caption p-4 sm:p-5">{children}</div>}
    </div>
  );
}
