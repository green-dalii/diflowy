import jsyaml from 'js-yaml';

export interface YamlData {
    app: {
      name: string;
      description: string;
      icon: string;
      mode: string;
    };
    workflow: {
      graph: {
        nodes: Array<{
          id: string;
          position: { x: number; y: number };
          data: { 
            title: string;
            desc: string;
            type: string;
            model?: {
              name: string;
            }
          };
          sourcePosition: string;
          targetPosition: string;
          width?: number;
          height?: number;
          zIndex?: number;
          parentId?: string;
        }>;
        edges: Array<{
          id: string;
          source: string;
          target: string;
        }>;
      };
    };
  }
  
  export function parseYamlToReactFlow(yamlContent: string): { nodes: any[]; edges: any[]; usedModal: string[], flowMode: string } {
    const yamlData = jsyaml.load(yamlContent) as YamlData;
    // Extract nodes data
    const nodes = yamlData.workflow.graph.nodes
    .filter((node) => node.data.type !== '')    // 过滤掉 type 为空的节点，比如标签节点
    .map((node) => ({
      id: node.id,
      position: node.position,
      data: { 
        label: node.data.title,
        description: node.data.desc,
        nodeType: node.data.type,
        model: node.data.model ? node.data.model.name : undefined,
        width: node.width,
        height: node.height,
        zIndex: node.zIndex,
      },
      type: "custom",
      sourcePosition: node.sourcePosition,
      targetPosition: node.targetPosition,
      parentId: node.parentId,
    }));
    // Extract edges data
    const edges = yamlData.workflow.graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "default",
    }));
    // Extract llm data
    const usedModal = Array.from(new Set(
      yamlData.workflow.graph.nodes
        .filter(node => node.data.model)
        .map(node => node.data.model ? node.data.model.name : undefined)
    )) as string[];
    // Extract flow mode
    const flowMode = yamlData.app.mode as string;
    // Return the parsed data
    return { nodes, edges, usedModal, flowMode };
  }

  export function paresYamlToJSON(yamlContent: string): any {
    return jsyaml.load(yamlContent);
  }