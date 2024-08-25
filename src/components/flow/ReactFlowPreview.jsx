import { useCallback, useState, useEffect } from 'react';
import { ReactFlow, applyEdgeChanges, applyNodeChanges, Background, MiniMap, Controls, useReactFlow, ReactFlowProvider } from '@xyflow/react';
// import '@xyflow/react/dist/base.css';
import '@xyflow/react/dist/style.css';
import '../../styles/workflow.css';
import CustomNode from './CustomNode';

const nodeTypes = {
  custom: CustomNode,
};

const initialNodes = [
    {
        id: '1',
        sourcePosition: 'right',
        targetPosition: 'left',
        type: 'custom',
        data: { 
            label: '📤 Upload',
            description: 'Upload a DSL file to start your workflow'
        },
        position: { x: 100, y: 100 },
        justify: 'center',
        align: 'center',
    },
    {
        id: '2',
        sourcePosition: 'right',
        targetPosition: 'left',
        type: 'custom',
        data: { 
            label: '🔄 Parsing',
            description: 'The workflow will be parsed quickly and safely in your browser' 
        },
        position: { x: 300, y: 250 },
    },
    {
        id: '3',
        sourcePosition: 'right',
        targetPosition: 'left',
        type: 'custom',
        data: { 
            label: '👁️ Preview', 
            description: 'Finally you will see the simplified structure preview of your worflow here'
        },
        position: { x: 500, y: 400 },
    },
];

const initialEdges = [
    { id: 'e1-2', source: '1', target: '2', animated: true },
    { id: 'e2-3', source: '2', target: '3', animated: true },
];

const ReactFlowPreview = () => {
    const [nodes, setNodes] = useState(initialNodes);
    const [edges, setEdges] = useState(initialEdges);

    const onNodesChange = useCallback(
        (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
        [setNodes],
    );
    const onEdgesChange = useCallback(
        (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
        [setEdges],
    );
    const reactFlowInstance = useReactFlow();

    useEffect(() => {
        // Expose the update function to the global scope
        window.updateReactFlow = (newNodes, newEdges) => {
            setNodes(newNodes);
            setEdges(newEdges);
            // Fit the view to the graph
            reactFlowInstance.fitView(true);
        };

        // Cleanup function
        return () => {
            delete window.updateReactFlow;
        };
    }, []);

    return (
        <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            zoomOnScroll={false}
            panOnDrag={true}
            className="bg-gray-100"
            nodeTypes={nodeTypes}
            minZoom={0.1}
            fitView >
            <Background />
            <MiniMap pannable position='bottom-left' maskColor='rgb(240, 240, 250, 0.6)' />
            <Controls />
        </ReactFlow>
    );
};

// export default ReactFlowPreview;
// wrapping with ReactFlowProvider is done outside of the component
function FlowWithProvider(props) {
    return (
      <ReactFlowProvider>
        <ReactFlowPreview {...props} />
      </ReactFlowProvider>
    );
  }
   
export default FlowWithProvider;