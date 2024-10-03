/// <reference types="astro/client" />
import type { Node, Edge } from '@xyflow/react';
declare namespace App {
	interface Locals {
		session: import("lucia").Session | null;
		user: import("lucia").User | null;
	}
}

declare module globalThis {
	interface Window {
		updateReactFlow?: (nodes: any[], edges: any[]) => void;
	}
}

export {};