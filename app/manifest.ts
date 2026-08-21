import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest { return {
  name:'NeedleDrop', short_name:'NeedleDrop', description:'Your Navidrome library as a virtual vinyl collection.',
  start_url:'/', display:'standalone', background_color:'#11100d', theme_color:'#11100d', orientation:'any',
  icons:[{src:'/icon.svg',sizes:'any',type:'image/svg+xml'}]
}; }
