import jsyaml from 'js-yaml';

export interface YamlData {
    app: {
      name: string;
      description: string;
    };
    workflow: {
      graph: {
        nodes: Array<{
          id: string;
          position: { x: number; y: number };
          data: { 
            title: string;
            desc: string;
            model?: {
              name: string;
            }
          };
          sourcePosition: string;
          targetPosition: string;
        }>;
        edges: Array<{
          id: string;
          source: string;
          target: string;
        }>;
      };
    };
  }
  
  export function parseYamlToReactFlow(yamlContent: string): { nodes: any[]; edges: any[] } {
    const yamlData = jsyaml.load(yamlContent) as YamlData;
    const nodes = yamlData.workflow.graph.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      data: { 
        label: node.data.title,
        description: node.data.desc,
        model: node.data.model ? node.data.model.name : undefined,
      },
      type: "custom",
      sourcePosition: node.sourcePosition,
      targetPosition: node.targetPosition,
    }));
  
    const edges = yamlData.workflow.graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "default",
    }));
  
    return { nodes, edges };
  }

  export function paresYamlToJSON(yamlContent: string): any {
    return jsyaml.load(yamlContent);
  }