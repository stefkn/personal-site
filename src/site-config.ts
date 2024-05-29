export type SiteConfig = {
    title: string;
    subtitle?: string;
    description: string;
    pageType: string;
    image?: {src: string; alt: string};
    postsPerPage?: number;
    projectsPerPage?: number;
};

const siteConfig: SiteConfig = {
    title: 'steken.dev',
    subtitle: 'software, hardware, wetware',
    description: 'stefan nowak, software engineer based in London, UK',
    pageType: 'website',
    image: {
        src: '/favicon.png',
        alt: 'steken.dev logo'
    },
};

export default siteConfig;
