import ReactMarkdown from 'react-markdown';
/** CommonMark without executable HTML or automatically fetched third-party images. */
export function ResourceMarkdown({ body, className = '', testId }: { body: string; className?: string; testId?: string }) {
  return <div data-testid={testId} className={`break-words text-navy [&_p]:my-4 [&_li]:my-1 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_h1]:font-display [&_h1]:text-2xl [&_h2]:font-display [&_h2]:text-xl [&_h3]:font-display [&_h3]:text-lg [&_h1]:mt-6 [&_h2]:mt-6 [&_h3]:mt-5 [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_a]:font-bold [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-blue [&_blockquote]:pl-4 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-gray [&_pre]:p-4 ${className}`}>
    <ReactMarkdown skipHtml components={{
      a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      img: ({ alt }) => <span>{alt ? `[Image: ${alt}]` : '[Image]'}</span>,
    }}>{body}</ReactMarkdown>
  </div>;
}
