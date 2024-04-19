export type SiteConfig = {
    logo?: Image;
    title: string;
    subtitle?: string;
    description: string;
    pageType: string;
    image?: Image;
    headerNavLinks?: Link[];
    footerNavLinks?: Link[];
    socialLinks?: Link[];
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
